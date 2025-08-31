// controllers/proxyController.js
// Handles the core logic of proxying requests to the respective AI providers.

const axios = require('axios');
const crypto = require('crypto');
const keyManager = require('../services/keyManager');
const statsService = require('../services/statsService');
const promptService = require('../services/promptService');
const logService = require('../services/logService');

/**
 * --- REWRITTEN & CORRECTED ---
 * This function takes the final, ordered message array from promptService and
 * intelligently formats it for the Claude Messages API, preserving the position
 * of the <<CHAT_HISTORY>> placeholder and other mid-conversation instructions.
 *
 * It addresses the issue where system messages were always hoisted to the top.
 * Now, only leading system messages are put into the 'system' parameter. Any
 * system message appearing later in the sequence is merged into the next 'user'
 * message, preserving its intended position in the conversation flow.
 */
function formatFinalMessagesForClaude(finalMessages) {
    const system_prompt_parts = [];
    const intermediate_messages = [];

    // 1. Separate leading system messages from the main conversation body.
    let conversation_started = false;
    for (const message of finalMessages) {
        if (!conversation_started && message.role === 'system') {
            system_prompt_parts.push(message.content);
        } else {
            conversation_started = true;
            intermediate_messages.push({ ...message });
        }
    }

    // 2. Merge any mid-conversation system messages into the next user message.
    const merged_messages = [];
    let system_content_buffer = [];
    for (const message of intermediate_messages) {
        if (message.role === 'system') {
            system_content_buffer.push(message.content);
        } else {
            if (system_content_buffer.length > 0 && message.role === 'user') {
                const merged_system_content = system_content_buffer.join('\n\n');
                message.content = `${merged_system_content}\n\n${message.content}`;
                system_content_buffer = []; // Clear the buffer
            }
            merged_messages.push(message);
        }
    }

    // 3. Sanitize for Claude's strict user/assistant alternation rule.
    const final_message_blocks = [];
    for (const message of merged_messages) {
        // Skip any empty messages that might have slipped through.
        if (!message.content || typeof message.content !== 'string' || message.content.trim() === '') {
            continue;
        }

        const lastMessage = final_message_blocks[final_message_blocks.length - 1];
        if (lastMessage && lastMessage.role === message.role) {
            // If the role is the same as the last one, merge the content.
            lastMessage.content = `${lastMessage.content}\n\n${message.content}`;
        } else {
            // Otherwise, add the new message object.
            final_message_blocks.push({
                role: message.role,
                content: message.content // Content is now a simple string
            });
        }
    }
    
    // 4. Final formatting for the API (string content to content blocks).
    const formatted_messages = final_message_blocks.map(msg => ({
        role: msg.role,
        content: [{ type: 'text', text: msg.content }]
    }));


    return {
        system: system_prompt_parts.length > 0 ? system_prompt_parts.join('\n\n') : undefined,
        messages: formatted_messages,
    };
}


function claudeToOpenAIResponse(claudeResponse, providerConfig) {
    const content = claudeResponse.content?.[0]?.text || '';
    return {
        id: claudeResponse.id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: providerConfig.modelId,
        choices: [{
            index: 0,
            message: { role: 'assistant', content: content },
            finish_reason: claudeResponse.stop_reason,
        }],
        usage: {
            prompt_tokens: claudeResponse.usage.input_tokens,
            completion_tokens: claudeResponse.usage.output_tokens,
            total_tokens: claudeResponse.usage.input_tokens + claudeResponse.usage.output_tokens,
        },
    };
}

function claudeStreamChunkToOpenAI(claudeChunk, providerConfig) {
    let choices = [];
    let finish_reason = null;
    switch (claudeChunk.type) {
        case 'content_block_delta':
            if (claudeChunk.delta?.type === 'text_delta') {
                choices.push({ index: 0, delta: { content: claudeChunk.delta.text }, finish_reason: null });
            }
            break;
        case 'message_delta':
            if (claudeChunk.delta?.stop_reason) {
                finish_reason = claudeChunk.delta.stop_reason;
                 choices.push({ index: 0, delta: {}, finish_reason: finish_reason });
            }
            break;
        case 'message_stop': break;
        default: return null;
    }
    if (choices.length === 0) return null;
    return {
        id: `chatcmpl-${crypto.randomBytes(12).toString('hex')}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: providerConfig.modelId,
        choices: choices,
    };
}

exports.proxyRequest = async (req, res, provider) => {
    const reqId = crypto.randomBytes(4).toString('hex');
    const tokenUser = req.userTokenInfo ? ` (Token: ${req.userTokenInfo.name})` : '';
    console.log(`\n--- [${reqId}] New Request for Provider: ${provider}${tokenUser} ---`);

    statsService.incrementPromptCount();
    const rotatingKey = keyManager.getRotatingKey(provider);

    if (!rotatingKey) {
        console.error(`[${reqId}] No active keys available for ${provider}.`);
        return res.status(503).json({ error: `No active API keys available for provider '${provider}'.` });
    }

    const apiKey = rotatingKey.value;
    const originalBody = req.body;
    const providerConfig = keyManager.getProviderConfig(provider);

    try {
        const finalMessages = await promptService.buildFinalMessages(provider, originalBody.messages, reqId);
        const finalBody = { ...originalBody, messages: finalMessages };

        if (providerConfig.providerType === 'claude') {
            await handleClaudeRequest(reqId, res, finalBody, apiKey, providerConfig);
        } else {
            await handleOpenAICompatibleRequest(reqId, res, finalBody, apiKey, provider, providerConfig);
        }
    } catch (error) {
        await handleProxyError(reqId, res, error, provider, apiKey);
    }
};

async function handleOpenAICompatibleRequest(reqId, res, body, apiKey, provider, providerConfig) {
    let forwardUrl, forwardBody, headers;

    if (providerConfig.isCustom) {
        if (providerConfig.enforcedModelName && body.model !== providerConfig.enforcedModelName) {
            return res.status(400).json({ error: { message: `The model \`${body.model}\` does not exist for this provider. Please use the correct model: \`${providerConfig.enforcedModelName}\`.`, type: 'invalid_request_error' } });
        }
        forwardUrl = `${providerConfig.apiBaseUrl}/v1/chat/completions`;
        forwardBody = { ...body, model: providerConfig.modelId };
        headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
        if (providerConfig.maxOutput && providerConfig.maxOutput !== 'Unlimited') {
            const adminMaxTokens = parseInt(providerConfig.maxOutput, 10);
            if (!isNaN(adminMaxTokens)) {
                forwardBody.max_tokens = adminMaxTokens;
            }
        }
    } else {
        switch (provider) {
            case 'gemini':
                forwardUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;
                const contents = body.messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content || '' }] }));
                forwardBody = { contents, generation_config: { temperature: body.temperature, top_p: body.top_p } };
                headers = { 'Content-Type': 'application/json' };
                break;
            case 'deepseek':
            case 'openai':
            case 'openrouter':
            case 'mistral':
                forwardBody = { ...body };
                headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
                if (provider === 'deepseek') forwardUrl = 'https://api.deepseek.com/chat/completions';
                if (provider === 'openai') forwardUrl = 'https://api.openai.com/v1/chat/completions';
                if (provider === 'openrouter') forwardUrl = 'https://openrouter.ai/api/v1/chat/completions';
                if (provider === 'mistral') forwardUrl = 'https://api.mistral.ai/v1/chat/completions';
                break;
            default:
                return res.status(400).json({ error: `Unsupported provider: ${provider}` });
        }
    }
    
    logService.logRequest(reqId, forwardBody);

    const providerResponse = await axios.post(forwardUrl, forwardBody, { headers, responseType: body.stream ? 'stream' : 'json' });
    keyManager.recordSuccess(provider, apiKey);

    if (body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        providerResponse.data.pipe(res);
    } else {
        let responseData = providerResponse.data;
        if (provider === 'gemini') {
            const responseText = responseData.candidates?.[0]?.content?.parts?.[0]?.text || '';
            responseData = { choices: [{ message: { role: 'assistant', content: responseText } }], usage: { prompt_tokens: 0, completion_tokens: 0 } };
        }
        let usage = responseData.usage || { prompt_tokens: 0, completion_tokens: 0 };
        statsService.addTokens(usage.prompt_tokens, usage.completion_tokens);
        res.status(providerResponse.status).json(responseData);
    }
    console.log(`--- [${reqId}] OpenAI-Compatible Request Completed Successfully ---`);
}

async function handleClaudeRequest(reqId, res, body, apiKey, providerConfig) {
    const forwardUrl = `${providerConfig.apiBaseUrl}/v1/messages`;
    
    // 1. Format the final, ordered messages from promptService into the correct Claude block structure.
    const { system, messages } = formatFinalMessagesForClaude(body.messages);

    if (messages.length === 0 && !system) {
        console.error(`[${reqId}] Aborting Claude request: No valid messages or system prompt found after formatting.`);
        return res.status(400).json({ error: "Invalid request: No valid messages or system prompt to send after processing." });
    }

    // 2. Build the final request body using the correctly structured data.
    const forwardBody = {
        model: providerConfig.modelId,
        messages: messages,
        max_tokens: body.max_tokens || 4096,
        stream: body.stream || false,
        // Pass through other common parameters
        temperature: body.temperature,
        top_p: body.top_p,
        top_k: body.top_k,
        stop_sequences: body.stop_sequences,
    };
    if (system) {
        forwardBody.system = system;
    }
    
    const headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
    };
    
    console.log(`[${reqId}] Forwarding to Claude API. System prompt length: ${forwardBody.system?.length || 0}. Message count: ${forwardBody.messages.length}.`);
    
    logService.logRequest(reqId, forwardBody);

    const providerResponse = await axios.post(forwardUrl, forwardBody, { headers, responseType: body.stream ? 'stream' : 'json' });
    keyManager.recordSuccess(providerConfig.name, apiKey);

    if (body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        providerResponse.data.on('data', chunk => {
            const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const dataStr = line.substring(6);
                        const claudeChunk = JSON.parse(dataStr);
                        const openaiChunk = claudeStreamChunkToOpenAI(claudeChunk, providerConfig);
                        if (openaiChunk) res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                    } catch (error) {
                        console.error(`[${reqId}] Error parsing Claude stream chunk:`, error);
                    }
                }
            }
        });
        providerResponse.data.on('end', () => {
            res.write('data: [DONE]\n\n');
            res.end();
        });
    } else {
        const responseData = claudeToOpenAIResponse(providerResponse.data, providerConfig);
        statsService.addTokens(responseData.usage.prompt_tokens, responseData.usage.completion_tokens);
        res.status(200).json(responseData);
    }
    console.log(`--- [${reqId}] Claude Request Completed Successfully ---`);
}

async function handleProxyError(reqId, res, error, provider, apiKey) {
    if (error instanceof promptService.UserInputError) {
        console.warn(`[${reqId}] User Input Error: ${error.message}`);
        return res.status(400).json({ error: 'Invalid command usage', detail: error.message });
    }
    console.error(`[${reqId}] Proxy Error: Provider: ${provider}, Status: ${error.response?.status}, Message: ${error.message}`);
    const status = error.response?.status;
    if (status === 402) keyManager.deactivateKey(provider, apiKey, 'over_quota');
    else if (status === 429) keyManager.recordFailure(provider, apiKey);
    else if (status === 401 || status === 403) keyManager.deactivateKey(provider, apiKey, 'revoked');
    if (!res.headersSent) {
        let errorData = error.response?.data;
        if (errorData && typeof errorData.pipe === 'function') {
            try {
                const streamData = await new Promise((resolve, reject) => {
                    const chunks = [];
                    errorData.on('data', chunk => chunks.push(chunk));
                    errorData.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                    errorData.on('error', reject);
                });
                try { errorData = JSON.parse(streamData); }
                catch (e) { errorData = { error: 'Failed to parse error stream from provider', detail: streamData }; }
            } catch (streamError) {
                errorData = { error: 'Failed to read error stream from provider.' };
            }
        } else if (Buffer.isBuffer(errorData)) {
             errorData = { error: 'Received buffer error from provider', detail: errorData.toString('utf8') };
        } else if (!errorData) {
            errorData = { error: 'An internal proxy error occurred with no response from the provider.' };
        }
        res.status(status || 500).json(errorData);
    }
    console.log(`--- [${reqId}] Request Failed ---`);
}
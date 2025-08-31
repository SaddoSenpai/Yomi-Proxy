// controllers/proxyController.js
// Handles the core logic of proxying requests to the respective AI providers.

const axios = require('axios');
const crypto = require('crypto');
const keyManager = require('../services/keyManager');
const statsService = require('../services/statsService');
const promptService = require('../services/promptService');

// --- CLAUDE INTEGRATION: Helper to convert OpenAI request to Claude ---
function openAIToClaudeRequest(openaiRequest, providerConfig) {
    let systemPrompt = '';
    // Claude requires the first message to be from a 'user'.
    // We filter out empty messages and find the first non-system message.
    const filteredMessages = openaiRequest.messages.filter(message => {
        if (message.role === 'system') {
            systemPrompt = message.content;
            return false; // Exclude system prompt from messages array
        }
        // Exclude any messages that might be empty
        return message.content && message.content.trim() !== '';
    });

    const claudeRequest = {
        model: providerConfig.modelId,
        messages: filteredMessages,
        max_tokens: openaiRequest.max_tokens || 4096, // Claude requires max_tokens
        stream: openaiRequest.stream || false,
    };

    if (systemPrompt) {
        claudeRequest.system = systemPrompt;
    }
    if (openaiRequest.temperature) {
        claudeRequest.temperature = openaiRequest.temperature;
    }
    if (openaiRequest.top_p) {
        claudeRequest.top_p = openaiRequest.top_p;
    }
    // Note: Add other parameter mappings if needed

    return claudeRequest;
}

// --- CLAUDE INTEGRATION: Helper to convert Claude non-streaming response to OpenAI ---
function claudeToOpenAIResponse(claudeResponse, providerConfig) {
    const content = claudeResponse.content?.[0]?.text || '';
    return {
        id: claudeResponse.id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: providerConfig.modelId, // Or a mapped model name
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content: content,
            },
            finish_reason: claudeResponse.stop_reason,
        }],
        usage: {
            prompt_tokens: claudeResponse.usage.input_tokens,
            completion_tokens: claudeResponse.usage.output_tokens,
            total_tokens: claudeResponse.usage.input_tokens + claudeResponse.usage.output_tokens,
        },
    };
}

// --- CLAUDE INTEGRATION: Helper to convert a Claude stream chunk to an OpenAI stream chunk ---
function claudeStreamChunkToOpenAI(claudeChunk, providerConfig) {
    let choices = [];
    let finish_reason = null;

    switch (claudeChunk.type) {
        case 'content_block_delta':
            if (claudeChunk.delta?.type === 'text_delta') {
                choices.push({
                    index: 0,
                    delta: {
                        content: claudeChunk.delta.text,
                    },
                    finish_reason: null,
                });
            }
            break;
        
        case 'message_delta':
            // This can contain the stop_reason
            if (claudeChunk.delta?.stop_reason) {
                finish_reason = claudeChunk.delta.stop_reason;
                 choices.push({
                    index: 0,
                    delta: {},
                    finish_reason: finish_reason,
                });
            }
            break;

        case 'message_stop':
            // The final event contains the stop reason.
            // We might have already sent it in message_delta, but we can send an empty final choice block.
            break;
        
        default:
            return null; // Ignore other event types like message_start
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


/**
 * Proxies an incoming request to the specified AI provider.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {string} provider - The name of the provider (e.g., 'gemini').
 */
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
    const body = req.body;
    
    const providerConfig = keyManager.getProviderConfig(provider);

    try {
        const finalMessages = await promptService.buildFinalMessages(provider, body.messages, reqId);
        const finalBody = { ...body, messages: finalMessages }; // Use finalMessages for all providers

        // --- CLAUDE INTEGRATION: Check provider type and branch logic ---
        if (providerConfig.providerType === 'claude') {
            await handleClaudeRequest(reqId, res, finalBody, apiKey, providerConfig);
        } else {
            await handleOpenAICompatibleRequest(reqId, res, finalBody, apiKey, provider, providerConfig);
        }

    } catch (error) {
        handleProxyError(reqId, res, error, provider, apiKey);
    }
};

// --- Refactored logic for OpenAI-compatible providers ---
async function handleOpenAICompatibleRequest(reqId, res, body, apiKey, provider, providerConfig) {
    let forwardUrl, forwardBody, headers;

    if (providerConfig.isCustom) {
        if (providerConfig.enforcedModelName && body.model !== providerConfig.enforcedModelName) {
            console.warn(`[${reqId}] Incorrect model requested. User sent '${body.model}', but provider '${provider}' requires '${providerConfig.enforcedModelName}'.`);
            return res.status(400).json({
                error: {
                    message: `The model \`${body.model}\` does not exist for this provider. Please use the correct model: \`${providerConfig.enforcedModelName}\`.`,
                    type: 'invalid_request_error',
                    param: 'model',
                    code: 'model_not_found'
                }
            });
        }
        forwardUrl = `${providerConfig.apiBaseUrl}/v1/chat/completions`;
        forwardBody = { ...body, model: providerConfig.modelId };
        headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
        if (providerConfig.maxOutput && providerConfig.maxOutput !== 'Unlimited') {
            const adminMaxTokens = parseInt(providerConfig.maxOutput, 10);
            if (!isNaN(adminMaxTokens)) {
                console.log(`[${reqId}] Admin has set max_tokens to ${adminMaxTokens}. Overriding user value (if any).`);
                forwardBody.max_tokens = adminMaxTokens;
            }
        }
    } else {
        // ... (existing switch case for built-in providers like gemini, deepseek, etc.)
        switch (provider) {
            case 'gemini':
                forwardUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;
                const contents = body.messages.map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content || '' }]
                }));
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

    const providerResponse = await axios.post(forwardUrl, forwardBody, { 
        headers, 
        responseType: body.stream ? 'stream' : 'json' 
    });

    keyManager.recordSuccess(provider, apiKey);

    if (body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        providerResponse.data.pipe(res);
    } else {
        let responseData = providerResponse.data;
        if (provider === 'gemini') {
            const responseText = responseData.candidates?.[0]?.content?.parts?.[0]?.text || '';
            responseData = {
                choices: [{ message: { role: 'assistant', content: responseText } }],
                usage: { prompt_tokens: 0, completion_tokens: 0 }
            };
        }
        let usage = responseData.usage || { prompt_tokens: 0, completion_tokens: 0 };
        statsService.addTokens(usage.prompt_tokens, usage.completion_tokens);
        res.status(providerResponse.status).json(responseData);
    }
    console.log(`--- [${reqId}] OpenAI-Compatible Request Completed Successfully ---`);
}

// --- CLAUDE INTEGRATION: New function to handle Claude-specific logic ---
async function handleClaudeRequest(reqId, res, body, apiKey, providerConfig) {
    const forwardUrl = `${providerConfig.apiBaseUrl}/v1/messages`;
    const forwardBody = openAIToClaudeRequest(body, providerConfig);
    const headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
    };
    
    console.log(`[${reqId}] Forwarding to Claude API: ${forwardUrl}`);

    const providerResponse = await axios.post(forwardUrl, forwardBody, { 
        headers, 
        responseType: body.stream ? 'stream' : 'json' 
    });

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
                        if (openaiChunk) {
                            res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                        }
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


// --- Centralized Error Handling ---
function handleProxyError(reqId, res, error, provider, apiKey) {
    if (error instanceof promptService.UserInputError) {
        console.warn(`[${reqId}] User Input Error: ${error.message}`);
        return res.status(400).json({ error: 'Invalid command usage', detail: error.message });
    }

    console.error(`[${reqId}] Proxy Error: Provider: ${provider}, Status: ${error.response?.status}, Message: ${error.message}`);
    
    const status = error.response?.status;
    if (status === 402) {
        keyManager.deactivateKey(provider, apiKey, 'over_quota');
    } else if (status === 429) {
        keyManager.recordFailure(provider, apiKey);
    } else if (status === 401 || status === 403) {
        keyManager.deactivateKey(provider, apiKey, 'revoked');
    }

    if (!res.headersSent) {
        res.status(status || 500).json(error.response?.data || { error: 'An internal proxy error occurred.' });
    }
    console.log(`--- [${reqId}] Request Failed ---`);
}
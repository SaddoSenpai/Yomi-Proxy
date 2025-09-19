// services/promptService.js
// Manages database interactions for prompt structures and commands, including JanitorAI parsing.

const pool = require('../config/db');

class UserInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserInputError';
  }
}

function parseJanitorInput(incomingMessages) {
  let userInfo = '';
  let customPromptInfo = ''; 
  let unparsedText = '';
  let characterName = 'Character';

  if (!incomingMessages || incomingMessages.length === 0) {
    return { userInfo, customPromptInfo, unparsedText, characterName, chatHistory: [] };
  }

  const setupMessageContent = incomingMessages[0].content || '';
  let remainingText = setupMessageContent;

  const userRegex = /<UserPersona>([\s\S]*?)<\/UserPersona>/;
  const userMatch = remainingText.match(userRegex);
  if (userMatch) {
    userInfo = userMatch[1].trim();
    remainingText = remainingText.replace(userMatch[0], '');
  }

  const customPromptRegex = /<Custom_Prompt>([\s\S]*?)<\/Custom_Prompt>/;
  const customPromptMatch = remainingText.match(customPromptRegex);
  if (customPromptMatch) {
    customPromptInfo = customPromptMatch[1].trim();
    remainingText = remainingText.replace(customPromptMatch[0], '');
  }

  const charRegex = /<(.+?)'s Persona>/;
  const charMatch = setupMessageContent.match(charRegex);
  if (charMatch) {
    characterName = charMatch[1];
  }

  unparsedText = remainingText.trim();

  const chatHistory = incomingMessages.slice(1).map(m => {
      if (m.role === 'assistant' && m.content && m.content.includes('<w>')) {
          console.log('[History Cleaning] Found <w> tag in assistant message. Cleaning for next prompt.');
          return { ...m, content: m.content.split('<w>').pop().trim() };
      }
      return m;
  });

  return { userInfo, customPromptInfo, unparsedText, characterName, chatHistory };
}

function parseCommandsFromMessages(messages) {
    if (!messages || messages.length === 0) return [];
    const fullText = messages.map(m => m.content || '').join(' ');
    const commandRegex = /<([A-Z0-9_]+)>/g;
    const matches = [...fullText.matchAll(commandRegex)];
    return [...new Set(matches.map(match => match[1].toUpperCase()))];
}

async function getCommandDefinitions(commandTags) {
    if (commandTags.length === 0) return [];
    const result = await pool.query('SELECT * FROM commands WHERE command_tag = ANY($1)', [commandTags]);
    return result.rows;
}

async function buildFinalMessages(provider, incomingMessages, reqId) {
    const requestVariables = new Map();

    const processMacros = (text) => {
        let processedText = text;
        const setMacroRegex = /{{setglobalvar::([^:]+)::([\s\S]*?)}}/g;
        processedText = processedText.replace(setMacroRegex, (match, name, value) => {
            console.log(`[${reqId}] Macro: Setting variable '${name}' to '${value}'`);
            requestVariables.set(name.trim(), value);
            return '';
        });

        const getMacroRegex = /{{getglobalvar::([^}]+)}}/g;
        processedText = processedText.replace(getMacroRegex, (match, name) => {
            const trimmedName = name.trim();
            if (requestVariables.has(trimmedName)) {
                const value = requestVariables.get(trimmedName);
                console.log(`[${reqId}] Macro: Getting variable '${trimmedName}', found value '${value}'`);
                return value;
            }
            console.warn(`[${reqId}] Macro: Variable '${trimmedName}' not found.`);
            return '';
        });

        return processedText;
    };

    let structureToUse = await getStructure(provider);
    if (structureToUse.length === 0 && provider !== 'default') {
        console.log(`[${reqId}] No structure for '${provider}', falling back to 'default'.`);
        structureToUse = await getStructure('default');
    }

    // --- LOGIC CORRECTION ---
    // Parse commands from the ENTIRE set of incoming messages BEFORE splitting them up.
    const commandTags = parseCommandsFromMessages(incomingMessages);
    const commandDefinitions = await getCommandDefinitions(commandTags);
    // --- END LOGIC CORRECTION ---

    if (structureToUse.length === 0) {
        console.log(`[${reqId}] No global structure found. Passing messages through directly.`);
        const { characterName } = parseJanitorInput(incomingMessages);
        return { finalMessages: incomingMessages, characterName, commandTags };
    }
    
    console.log(`[${reqId}] Processing request with global structure for provider: ${provider}`);

    const { characterName, userInfo, customPromptInfo, unparsedText, chatHistory } = parseJanitorInput(incomingMessages);

    const prefillCommands = commandDefinitions.filter(cmd => cmd.command_type === 'Prefill');
    if (prefillCommands.length > 1) {
        throw new UserInputError(`Error: Only 1 Prefill command is allowed. Found: ${prefillCommands.map(cmd => `<${cmd.command_tag}>`).join(', ')}.`);
    }
    const hasPrefillCommand = prefillCommands.length > 0;
    
    const commandsByType = { 'Jailbreak': [], 'Additional Commands': [], 'Prefill': [] };
    commandDefinitions.forEach(cmd => {
        if (commandsByType[cmd.command_type]) {
            commandsByType[cmd.command_type].push({ role: cmd.block_role, content: cmd.block_content });
        }
    });
    
    const replacer = (text) => text
        .replace(/{{char}}/g, characterName)
        .replace(/<<USER_INFO>>/g, userInfo)
        .replace(/<<CUSTOM_PROMPT>>/g, customPromptInfo);

    const finalMessages = [];
    let historyInjected = false;

    for (const block of structureToUse) {
        if (block.block_type === 'Unparsed Text Injection') {
            if (unparsedText) {
                console.log(`[${reqId}] Injecting unparsed text into a '${block.role}' role block.`);
                finalMessages.push({ role: block.role, content: unparsedText });
            }
            continue;
        }

        let currentBlock = { ...block };

        if (currentBlock.block_type === 'Prompting Fallback' && currentBlock.replacement_command_id) {
            const overrideCommand = commandDefinitions.find(cmd => cmd.command_id === currentBlock.replacement_command_id);
            
            if (overrideCommand) {
                console.log(`[${reqId}] Fallback overridden: Block '${currentBlock.name}' is being replaced by command with ID '${overrideCommand.command_id}' (triggered by tag <${overrideCommand.command_tag}>).`);
                currentBlock.content = overrideCommand.block_content;
            } else {
                 console.log(`[${reqId}] Fallback active: Using default content for block '${currentBlock.name}'.`);
            }
        }

        const blockType = currentBlock.block_type;
        let contentSource = [];
        if (blockType === 'Conditional Prefill' && hasPrefillCommand) {
            continue;
        } else if (['Jailbreak', 'Additional Commands', 'Prefill'].includes(blockType)) {
            contentSource = commandsByType[blockType] || [];
        } else {
            contentSource = [currentBlock];
        }

        for (const item of contentSource) {
            let content = replacer(item.content || '');
            content = processMacros(content);
            const role = block.block_type === 'Additional Commands' ? block.role : item.role;

            if (content.includes('<<CHAT_HISTORY>>')) {
                const parts = content.split('<<CHAT_HISTORY>>');
                if (parts[0].trim()) finalMessages.push({ role, content: parts[0] });
                finalMessages.push(...chatHistory);
                if (parts[1].trim()) finalMessages.push({ role, content: parts[1] });
                historyInjected = true;
            } else {
                if (content.trim()) {
                    finalMessages.push({ role, content });
                }
            }
        }
    }

    if (!historyInjected) {
        console.warn(`[${reqId}] <<CHAT_HISTORY>> placeholder not found in structure. Appending history to the end.`);
        finalMessages.push(...chatHistory);
    }
    
    console.log(`[${reqId}] Prompt construction complete. Final message count: ${finalMessages.length}`);
    return { finalMessages, characterName, commandTags };
}

async function getStructure(provider) {
    const res = await pool.query('SELECT * FROM global_prompt_blocks WHERE provider = $1 ORDER BY position', [provider]);
    return res.rows;
}

async function setStructure(provider, blocks) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM global_prompt_blocks WHERE provider = $1', [provider]);
        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            await client.query(
                'INSERT INTO global_prompt_blocks (provider, name, role, content, position, is_enabled, block_type, replacement_command_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [provider, block.name, block.role, block.content, i, block.is_enabled, block.block_type, block.replacement_command_id || null]
            );
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

async function getCommands() {
    const res = await pool.query('SELECT * FROM commands ORDER BY command_tag');
    return res.rows;
}

async function saveCommand(commandData) {
    const { id, command_tag, command_id, block_name, block_role, block_content, command_type } = commandData;

    if (!command_id && command_type === 'Prompt Injecting') {
        throw new Error('A Command ID is required for the "Prompt Injecting" type.');
    }

    if (id) {
        await pool.query(
            'UPDATE commands SET command_tag = $1, block_name = $2, block_role = $3, block_content = $4, command_type = $5, command_id = $6, updated_at = NOW() WHERE id = $7',
            [command_tag.toUpperCase(), block_name, block_role, block_content, command_type, command_id, id]
        );
    } else {
        await pool.query(
            'INSERT INTO commands (command_tag, block_name, block_role, block_content, command_type, command_id) VALUES ($1, $2, $3, $4, $5, $6)',
            [command_tag.toUpperCase(), block_name, block_role, block_content, command_type, command_id]
        );
    }
}

async function deleteCommand(id) {
    await pool.query('DELETE FROM commands WHERE id = $1', [id]);
}


// --- NEW: Functions for Summarizer ---

const SUMMARIZER_TRIGGER_REGEX = /Create a brief, focused summary/i;

/**
 * Detects if a request is a standard chat or a special summarization request.
 * @param {Array<object>} messages - The incoming messages from the client.
 * @returns {{requestType: 'chat'|'summarize', triggerMessage: object|null}}
 */
function detectRequestType(messages) {
    if (!messages || messages.length === 0) {
        return { requestType: 'chat', triggerMessage: null };
    }

    // A summarizer request is typically the last message from the user
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === 'user' && SUMMARIZER_TRIGGER_REGEX.test(lastMessage.content)) {
        return { requestType: 'summarize', triggerMessage: lastMessage };
    }
    
    return { requestType: 'chat', triggerMessage: null };
}

/**
 * Fetches the summarizer structure for a given provider.
 * @param {string} provider - The provider ID.
 * @returns {Promise<Array<object>>} The structure blocks.
 */
async function getSummarizerStructure(provider) {
    const res = await pool.query('SELECT * FROM summarizer_prompt_blocks WHERE provider = $1 ORDER BY position', [provider]);
    return res.rows;
}

/**
 * Saves the summarizer structure for a given provider.
 * @param {string} provider - The provider ID.
 * @param {Array<object>} blocks - The array of structure blocks.
 */
async function setSummarizerStructure(provider, blocks) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM summarizer_prompt_blocks WHERE provider = $1', [provider]);
        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            await client.query(
                'INSERT INTO summarizer_prompt_blocks (provider, name, role, content, position, is_enabled) VALUES ($1, $2, $3, $4, $5, $6)',
                [provider, block.name, block.role, block.content, i, block.is_enabled]
            );
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}


/**
 * Builds the final message payload for a summarization request.
 * @param {string} provider - The target provider.
 * @param {Array<object>} incomingMessages - The full chat history including the trigger.
 * @param {object} triggerMessage - The user message that initiated the summary.
 * @param {string} reqId - The request ID for logging.
 * @returns {Promise<{finalMessages: Array<object>}>}
 */
async function buildSummarizerMessages(provider, incomingMessages, triggerMessage, reqId) {
    // 1. Get the custom summary instructions from the <summary> tag
    const summaryRegex = /<summary>([\s\S]*?)<\/summary>/;
    const summaryMatch = triggerMessage.content.match(summaryRegex);
    const summaryInfo = summaryMatch ? summaryMatch[1].trim() : '';

    // 2. The chat history is all messages *except* the trigger message
    const chatHistoryToSummarize = incomingMessages.filter(msg => msg !== triggerMessage);
    const formattedHistory = chatHistoryToSummarize
        .map(msg => `${msg.role.charAt(0).toUpperCase() + msg.role.slice(1)}: ${msg.content}`)
        .join('\n');

    // 3. Get the summarizer structure from the DB
    let structureToUse = await getSummarizerStructure(provider);
    if (structureToUse.length === 0 && provider !== 'default') {
        console.log(`[${reqId}] No summarizer structure for '${provider}', falling back to 'default'.`);
        structureToUse = await getSummarizerStructure('default');
    }

    if (structureToUse.length === 0) {
        throw new Error('No default summarizer structure is configured. Please set one up in the admin panel.');
    }
    
    // 4. Build the final messages using the structure
    const finalMessages = [];
    for (const block of structureToUse) {
        if (!block.content) continue;
        
        const content = block.content
            .replace(/<<SUMMARY>>/g, summaryInfo)
            .replace(/<<CHAT_HISTORY>>/g, formattedHistory);

        if (content.trim()) {
            finalMessages.push({ role: block.role, content });
        }
    }
    
    console.log(`[${reqId}] Summarizer prompt construction complete. Final message count: ${finalMessages.length}`);
    return { finalMessages };
}

module.exports = {
    buildFinalMessages,
    getStructure,
    setStructure,
    getCommands,
    saveCommand,
    deleteCommand,
    UserInputError,
    // --- NEWLY EXPORTED ---
    detectRequestType,
    buildSummarizerMessages,
    getSummarizerStructure,
    setSummarizerStructure
};
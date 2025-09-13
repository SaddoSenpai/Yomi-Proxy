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
  let characterName = 'Character';
  let characterInfo = '';
  let userInfo = '';
  let scenarioInfo = '';
  let summaryInfo = '';
  let customPromptInfo = ''; 
  const fullContent = (incomingMessages || []).map(m => m.content || '').join('\n\n');
  
  const charRegex = /<(.+?)'s Persona>([\s\S]*?)<\/\1's Persona>/;
  const charMatch = fullContent.match(charRegex);
  if (charMatch) {
    characterName = charMatch[1];
    characterInfo = charMatch[2].trim();
  }

  const userRegex = /<UserPersona>([\s\S]*?)<\/UserPersona>/;
  const userMatch = fullContent.match(userRegex);
  if (userMatch) {
    userInfo = userMatch[1].trim();
  }

  const scenarioRegex = /<scenario>([\s\S]*?)<\/scenario>/;
  const scenarioMatch = fullContent.match(scenarioRegex);
  if (scenarioMatch) {
    scenarioInfo = scenarioMatch[1].trim();
  }

  const summaryRegex = /<summary>([\s\S]*?)<\/summary>/;
  const summaryMatch = fullContent.match(summaryRegex);
  if (summaryMatch) {
    summaryInfo = summaryMatch[1].trim();
  }
  
  const customPromptRegex = /<Custom_Prompt>([\s\S]*?)<\/Custom_Prompt>/;
  const customPromptMatch = fullContent.match(customPromptRegex);
  if (customPromptMatch) {
    customPromptInfo = customPromptMatch[1].trim();
  }

  const chatHistory = (incomingMessages || [])
    .filter(m => {
        const content = m.content || '';
        return !content.includes("'s Persona>") && !content.includes("<UserPersona>") && !content.includes("<scenario>") && !content.includes("<summary>") && !content.includes("<Custom_Prompt>");
    })
    .map(m => {
        if (m.role === 'assistant' && m.content && m.content.includes('<w>')) {
            console.log('[History Cleaning] Found <w> tag in assistant message. Cleaning for next prompt.');
            return { ...m, content: m.content.split('<w>').pop().trim() };
        }
        return m;
    });

  return { characterName, characterInfo, userInfo, scenarioInfo, summaryInfo, customPromptInfo, chatHistory };
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

/**
 * --- REWRITTEN FROM SCRATCH (FINAL): The definitive prompt building logic. ---
 * This version uses a robust single-pass process to guarantee positional integrity.
 * It directly builds the final message array in the correct order.
 */
async function buildFinalMessages(provider, incomingMessages, reqId) {
    let structureToUse = await getStructure(provider);
    if (structureToUse.length === 0 && provider !== 'default') {
        console.log(`[${reqId}] No structure for '${provider}', falling back to 'default'.`);
        structureToUse = await getStructure('default');
    }

    if (structureToUse.length === 0) {
        console.log(`[${reqId}] No global structure found. Passing messages through directly.`);
        const { characterName } = parseJanitorInput(incomingMessages);
        const commandTags = parseCommandsFromMessages(incomingMessages);
        return { finalMessages: incomingMessages, characterName, commandTags };
    }
    
    console.log(`[${reqId}] Processing request with global structure for provider: ${provider}`);

    const { characterName, characterInfo, userInfo, scenarioInfo, summaryInfo, customPromptInfo, chatHistory } = parseJanitorInput(incomingMessages);
    const commandTags = parseCommandsFromMessages(incomingMessages);
    const commandDefinitions = await getCommandDefinitions(commandTags);

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
        .replace(/<<CHARACTER_INFO>>/g, characterInfo)
        .replace(/<<SCENARIO_INFO>>/g, scenarioInfo)
        .replace(/<<USER_INFO>>/g, userInfo)
        .replace(/<<SUMMARY>>/g, summaryInfo)
        .replace(/<<CUSTOM_PROMPT>>/g, customPromptInfo);

    const finalMessages = [];
    let historyInjected = false;

    // This single loop iterates through the structure from the database in the correct order.
    for (const block of structureToUse) {
        const blockType = block.block_type;

        // Determine the source of content for this position in the structure.
        // It's either the block itself or a list of commands for injection points.
        let contentSource = [];
        if (blockType === 'Conditional Prefill' && hasPrefillCommand) {
            continue; // Skip this block entirely if a prefill command is active.
        } else if (['Jailbreak', 'Additional Commands', 'Prefill'].includes(blockType)) {
            contentSource = commandsByType[blockType] || [];
        } else {
            contentSource = [block]; // Standard block or a Conditional Prefill that should run.
        }

        // Process each item for this position. (Usually just one, but can be multiple for injections).
        for (const item of contentSource) {
            const content = replacer(item.content || '');
            // If the block is an 'Additional Commands' injection point, use the role from the structure block.
            // Otherwise, use the role from the item itself (either another command type or a standard block).
            const role = block.block_type === 'Additional Commands' ? block.role : item.role;

            // The highest priority is to check for and inject the chat history.
            if (content.includes('<<CHAT_HISTORY>>')) {
                const parts = content.split('<<CHAT_HISTORY>>');
                if (parts[0].trim()) {
                    finalMessages.push({ role, content: parts[0] });
                }
                finalMessages.push(...chatHistory);
                if (parts[1].trim()) {
                    finalMessages.push({ role, content: parts[1] });
                }
                historyInjected = true;
            } else {
                // If no history placeholder, just add the content.
                if (content.trim()) {
                    finalMessages.push({ role, content });
                }
            }
        }
    }

    // Fallback: If the user forgot to include the placeholder in their structure,
    // append the history to the very end to prevent it from being lost.
    if (!historyInjected) {
        console.warn(`[${reqId}] <<CHAT_HISTORY>> placeholder not found in structure. Appending history to the end.`);
        finalMessages.push(...chatHistory);
    }
    
    console.log(`[${reqId}] Prompt construction complete. Final message count: ${finalMessages.length}`);
    return { finalMessages, characterName, commandTags };
}


// --- Database functions (unchanged) ---
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
                'INSERT INTO global_prompt_blocks (provider, name, role, content, position, is_enabled, block_type) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [provider, block.name, block.role, block.content, i, block.is_enabled, block.block_type]
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
    const { id, command_tag, block_name, block_role, block_content, command_type } = commandData;
    if (id) {
        await pool.query(
            'UPDATE commands SET command_tag = $1, block_name = $2, block_role = $3, block_content = $4, command_type = $5, updated_at = NOW() WHERE id = $6',
            [command_tag.toUpperCase(), block_name, block_role, block_content, command_type, id]
        );
    } else {
        await pool.query(
            'INSERT INTO commands (command_tag, block_name, block_role, block_content, command_type) VALUES ($1, $2, $3, $4, $5)',
            [command_tag.toUpperCase(), block_name, block_role, block_content, command_type]
        );
    }
}

async function deleteCommand(id) {
    await pool.query('DELETE FROM commands WHERE id = $1', [id]);
}

module.exports = {
    buildFinalMessages,
    getStructure,
    setStructure,
    getCommands,
    saveCommand,
    deleteCommand,
    UserInputError
};
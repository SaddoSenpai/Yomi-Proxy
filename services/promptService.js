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
  const fullContent = (incomingMessages || []).map(m => m.content || '').join('\n\n');
  
  const charRegex = /<([^\s>]+)'s Persona>([\sS]*?)<\/\1's Persona>/;
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

  const chatHistory = (incomingMessages || [])
    .filter(m => {
        const content = m.content || '';
        return !content.includes("'s Persona>") && !content.includes("<UserPersona>") && !content.includes("<scenario>") && !content.includes("<summary>");
    });

  return { characterName, characterInfo, userInfo, scenarioInfo, summaryInfo, chatHistory };
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
 * MODIFIED: Now accepts a reqId for detailed logging.
 */
async function buildFinalMessages(provider, incomingMessages, reqId) {
    let structureToUse = await getStructure(provider);
    if (structureToUse.length === 0 && provider !== 'default') {
        console.log(`[${reqId}] No structure for '${provider}', falling back to 'default'.`);
        structureToUse = await getStructure('default');
    }

    if (structureToUse.length === 0) {
        console.log(`[${reqId}] No global structure found. Passing messages through directly.`);
        return incomingMessages;
    }
    
    // MODIFIED: Added detailed logging steps.
    console.log(`[${reqId}] Processing request with global structure for provider: ${provider}`);

    const { characterName, characterInfo, userInfo, scenarioInfo, summaryInfo, chatHistory } = parseJanitorInput(incomingMessages);
    console.log(`[${reqId}] Parsed Character Name: ${characterName}`);
    
    const commandTags = parseCommandsFromMessages(incomingMessages);
    if (commandTags.length > 0) {
        console.log(`[${reqId}] Found commands: ${commandTags.join(', ')}. Attempting to inject blocks.`);
    } else {
        console.log(`[${reqId}] No commands found in user prompt.`);
    }
    
    const commandDefinitions = await getCommandDefinitions(commandTags);

    const prefillCommands = commandDefinitions.filter(cmd => cmd.command_type === 'Prefill');
    if (prefillCommands.length > 1) {
        const conflictingTags = prefillCommands.map(cmd => `<${cmd.command_tag}>`).join(', ');
        throw new UserInputError(`Error: Only 1 Prefill command is allowed. Found: ${conflictingTags}.`);
    }
    const hasPrefillCommand = prefillCommands.length > 0;

    const commandsByType = { 'Jailbreak': [], 'Additional Commands': [], 'Prefill': [] };
    commandDefinitions.forEach(cmd => {
        if (commandsByType[cmd.command_type]) {
            commandsByType[cmd.command_type].push({
                name: cmd.block_name, role: cmd.block_role, content: cmd.block_content,
            });
        }
    });

    const finalStructure = [];
    for (const block of structureToUse) {
        if (block.block_type === 'Conditional Prefill') {
            if (!hasPrefillCommand) finalStructure.push(block);
        } else if (block.block_type !== 'Standard') {
            const commandsToInject = commandsByType[block.block_type];
            if (commandsToInject?.length > 0) finalStructure.push(...commandsToInject);
        } else {
            finalStructure.push(block);
        }
    }

    const finalMessages = [];
    const replacer = (text) => text
        .replace(/{{char}}/g, characterName)
        .replace(/<<CHARACTER_INFO>>/g, characterInfo)
        .replace(/<<SCENARIO_INFO>>/g, scenarioInfo)
        .replace(/<<USER_INFO>>/g, userInfo)
        .replace(/<<SUMMARY>>/g, summaryInfo);

    for (const block of finalStructure) {
        let currentContent = block.content || '';
        if (currentContent.includes('<<CHAT_HISTORY>>')) {
            const parts = currentContent.split('<<CHAT_HISTORY>>');
            if (parts[0].trim()) {
                finalMessages.push({ role: block.role, content: replacer(parts[0]) });
            }
            finalMessages.push(...chatHistory);
            if (parts[1].trim()) {
                finalMessages.push({ role: block.role, content: replacer(parts[1]) });
            }
        } else {
            currentContent = replacer(currentContent);
            if (currentContent.trim()) {
                finalMessages.push({ role: block.role, content: currentContent });
            }
        }
    }
    
    console.log(`[${reqId}] Prompt construction complete. Final message count: ${finalMessages.length}`);
    return finalMessages;
}

// --- Database functions for structure and commands (unchanged) ---
// ... (rest of the file is the same)
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
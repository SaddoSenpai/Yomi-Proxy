// services/thinkFilter.js
// Provides utilities to filter <think> tags from AI responses,
// both for complete text and for streaming data.

/**
 * Removes <think> tags and their content from a complete block of text.
 * @param {string} text The full text from the AI response.
 * @returns {string} The text with all <think> blocks removed.
 */
function filterThinkTags(text) {
    if (!text || typeof text !== 'string') {
        return text;
    }
    // Use a non-greedy regex to remove all occurrences of <think>...</think>
    return text.replace(/<think>[\s\S]*?<\/think>/g, '');
}

/**
 * A stateful processor for filtering <think> tags from a stream of text chunks.
 * This version correctly buffers and discards content between the tags.
 */
class ThinkTagStreamProcessor {
    constructor() {
        this.buffer = '';
        this.isInsideThinkBlock = false;
    }

    /**
     * Processes an incoming chunk of text and returns the filtered output.
     * @param {string} chunk The incoming text chunk from the stream.
     * @returns {string} The filtered text chunk to be sent to the user.
     */
    process(chunk) {
        this.buffer += chunk;
        let output = '';

        // Use a loop to handle multiple tags within the same buffered chunk
        // eslint-disable-next-line no-constant-condition
        while (true) {
            if (this.isInsideThinkBlock) {
                const endTagIndex = this.buffer.indexOf('</think>');
                if (endTagIndex !== -1) {
                    // We found the end of a think block.
                    this.isInsideThinkBlock = false;
                    // Cut the buffer to start right after the closing tag.
                    this.buffer = this.buffer.substring(endTagIndex + '</think>'.length);
                    // Continue the loop to process the rest of the buffer, which is now considered outside a think block.
                } else {
                    // The end tag is not in the current buffer.
                    // This means the entire buffer is part of the think block.
                    // We discard it and wait for the next chunk which might contain the end tag.
                    this.buffer = '';
                    break; // Exit the loop, nothing to output from this chunk.
                }
            } else { // We are outside a think block
                const startTagIndex = this.buffer.indexOf('<think>');
                if (startTagIndex !== -1) {
                    // A think block starts in the current buffer.
                    // Output everything before the tag.
                    output += this.buffer.substring(0, startTagIndex);
                    this.isInsideThinkBlock = true;
                    // Cut the buffer to start right after the opening tag.
                    this.buffer = this.buffer.substring(startTagIndex + '<think>'.length);
                    // Continue the loop to see if the end tag is also in the remaining buffer.
                } else {
                    // No think block starts in the buffer.
                    // The entire buffer is safe to output.
                    output += this.buffer;
                    this.buffer = '';
                    break; // Exit the loop, we've processed the whole buffer.
                }
            }
        }
        return output;
    }
}

module.exports = {
    filterThinkTags,
    ThinkTagStreamProcessor,
};
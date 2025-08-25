// public/main.js
// This file handles client-side interactivity for the main public page.

document.addEventListener('DOMContentLoaded', () => {
    // Find all copy buttons on the page
    const copyButtons = document.querySelectorAll('.copy-btn');

    copyButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Get the endpoint URL from the button's data attribute
            const endpointToCopy = button.dataset.endpoint;

            // Use the modern Navigator Clipboard API to copy the text
            navigator.clipboard.writeText(endpointToCopy).then(() => {
                // --- Provide visual feedback to the user ---
                const originalText = button.textContent;
                button.textContent = 'Copied!';
                button.classList.add('copied');

                // Revert the button back to its original state after 2 seconds
                setTimeout(() => {
                    button.textContent = originalText;
                    button.classList.remove('copied');
                }, 2000);
            }).catch(err => {
                // Log an error if the copy command fails
                console.error('Failed to copy endpoint: ', err);
                alert('Could not copy text.');
            });
        });
    });
});
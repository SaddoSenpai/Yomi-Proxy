// public/main.js
// This file handles client-side interactivity for the main public page.

document.addEventListener('DOMContentLoaded', () => {
    // --- Copy Button Logic ---
    const copyButtons = document.querySelectorAll('.copy-btn');
    copyButtons.forEach(button => {
        button.addEventListener('click', () => {
            const endpointToCopy = button.dataset.endpoint;
            navigator.clipboard.writeText(endpointToCopy).then(() => {
                const originalText = button.textContent;
                button.textContent = 'Copied!';
                button.classList.add('copied');
                setTimeout(() => {
                    button.textContent = originalText;
                    button.classList.remove('copied');
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy endpoint: ', err);
                alert('Could not copy text.');
            });
        });
    });

    // --- NEW: Announcement Banner Logic ---
    const banner = document.getElementById('announcement-banner');
    if (banner) {
        const closeButton = document.getElementById('announcement-close');
        const currentMessage = banner.dataset.message;
        const cookieName = 'announcementDismissed';
        
        // Helper function to get a cookie value
        const getCookie = (name) => {
            const value = `; ${document.cookie}`;
            const parts = value.split(`; ${name}=`);
            if (parts.length === 2) return parts.pop().split(';').shift();
        };

        // Show the banner only if the user hasn't dismissed this specific message
        if (getCookie(cookieName) !== currentMessage) {
            banner.style.display = 'block';
            // Add padding to the body to prevent the banner from overlapping content
            document.body.style.paddingTop = `${banner.offsetHeight}px`;
        }

        closeButton.addEventListener('click', () => {
            banner.style.display = 'none';
            document.body.style.paddingTop = '2rem'; // Reset padding

            // Set a cookie to remember that this message has been dismissed
            // Expires in 7 days
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 7);
            document.cookie = `${cookieName}=${currentMessage}; expires=${expiryDate.toUTCString()}; path=/`;
        });
    }
});
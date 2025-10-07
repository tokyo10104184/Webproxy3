document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('proxy-form');
    const urlInput = document.getElementById('url-input');
    const frame = document.getElementById('proxy-frame');

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        let url = urlInput.value.trim();

        if (!url) {
            return;
        }

        // Add http:// if no protocol is present
        if (!/^(https?:\/\/)/i.test(url)) {
            url = 'http://' + url;
        }

        // Use about:blank to clear the iframe first, preventing potential issues.
        frame.src = 'about:blank';

        // Set the new src to our proxy endpoint
        setTimeout(() => {
            frame.src = `/api?url=${encodeURIComponent(url)}`;
        }, 100);
    });
});
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const esprima = require('esprima');
const estraverse = require('estraverse');
const escodegen = require('escodegen');

const app = express();

app.get('/api', async (req, res) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('URL is required');
    }

    try {
        const target = new URL(targetUrl);
        const proxyBase = `${req.protocol}://${req.get('host')}/api?url=`;

        const rewriteUrl = (path) => {
            if (!path || path.startsWith('data:') || path.startsWith('javascript:')) {
                return path;
            }
            try {
                // Resolve the path relative to the target URL
                const absoluteUrl = new URL(path, target.href).href;
                return `${proxyBase}${encodeURIComponent(absoluteUrl)}`;
            } catch (e) {
                // If it's an invalid URL, return it as is
                return path;
            }
        };

        const response = await axios({
            method: 'get',
            url: target.href,
            responseType: 'stream',
            headers: {
                'User-Agent': req.headers['user-agent'],
                'Accept': req.headers['accept'],
                'Accept-Language': req.headers['accept-language'],
            }
        });

        // Proxy headers
        Object.keys(response.headers).forEach(key => {
            let value = response.headers[key];
            if (key.toLowerCase() === 'location') {
                value = rewriteUrl(value);
            }
            if (key.toLowerCase() === 'set-cookie') {
                if (Array.isArray(value)) {
                    value = value.map(cookie => cookie.replace(/domain=([^;]+)/i, ''));
                } else {
                    value = value.replace(/domain=([^;]+)/i, '');
                }
            }
            // Prevent iframe blocking
            if (['content-security-policy', 'x-frame-options'].includes(key.toLowerCase())) {
                return;
            }
            res.setHeader(key, value);
        });

        const contentType = response.headers['content-type'];

        if (contentType && contentType.includes('text/html')) {
            let body = '';
            for await (const chunk of response.data) {
                body += chunk.toString();
            }
            const $ = cheerio.load(body);

            // Rewrite all relevant attributes
            $('[href]').each((i, el) => $(el).attr('href', rewriteUrl($(el).attr('href'))));
            $('[src]').each((i, el) => $(el).attr('src', rewriteUrl($(el).attr('src'))));
            $('[action]').each((i, el) => $(el).attr('action', rewriteUrl($(el).attr('action'))));
            $('[srcset]').each((i, el) => {
                const newSrcset = $(el).attr('srcset').split(',').map(part => {
                    const [url, descriptor] = part.trim().split(/\s+/);
                    return `${rewriteUrl(url)} ${descriptor || ''}`.trim();
                }).join(', ');
                $(el).attr('srcset', newSrcset);
            });
            // Rewrite inline styles
            $('[style]').each((i, el) => {
                const style = $(el).attr('style');
                const newStyle = style.replace(/url\((['"]?)(.*?)\1\)/gi, (match, quote, url) => `url(${quote}${rewriteUrl(url)}${quote})`);
                $(el).attr('style', newStyle);
            });

            res.send($.html());

        } else if (contentType && contentType.includes('text/css')) {
            let body = '';
            for await (const chunk of response.data) {
                body += chunk.toString();
            }
            const rewrittenBody = body.replace(/url\((['"]?)(.*?)\1\)/gi, (match, quote, url) => {
                // Don't rewrite data URIs
                if (url.startsWith('data:')) return match;
                return `url(${quote}${rewriteUrl(url)}${quote})`;
            });
            res.send(rewrittenBody);
        } else if (contentType && (contentType.includes('javascript') || contentType.includes('application/x-javascript'))) {
            let body = '';
            for await (const chunk of response.data) {
                body += chunk.toString();
            }
            try {
                const ast = esprima.parseScript(body);
                estraverse.traverse(ast, {
                    enter: function (node) {
                        if (node.type === 'Literal' && typeof node.value === 'string') {
                            // Simple check for something that looks like a path or URL
                            if (node.value.includes('/') || node.value.startsWith('http')) {
                                 // Avoid rewriting things that are clearly not URLs, like "image/jpeg"
                                if (!node.value.includes(' ') && node.value.length > 3) {
                                   node.value = rewriteUrl(node.value);
                                }
                            }
                        }
                    }
                });
                const rewrittenBody = escodegen.generate(ast);
                res.send(rewrittenBody);
            } catch (e) {
                // If parsing or rewriting fails, send the original code
                console.error("JavaScript AST processing error:", e.message);
                res.send(body);
            }
        } else {
            // For other content types, stream directly
            response.data.pipe(res);
        }

    } catch (error) {
        console.error(error);
        res.status(500).send(`Error fetching the URL: ${error.message}`);
    }
});

module.exports = app;
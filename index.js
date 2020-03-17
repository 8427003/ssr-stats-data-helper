const fs = require('fs-extra');
const path = require('path');

function isCssFile(asset) {
    if(!asset) return;
    return (asset.length - '.css'.length) === asset.lastIndexOf('.css');
}

function isJsFile(asset) {
    if(!asset) return;
    return (asset.length - '.js'.length) === asset.lastIndexOf('.js');
}

function initStats(stats) {
    const { chunks, entrypoints } = stats;

    if(!chunks || !entrypoints) {
        console.error('in stats, chunks and entrypoints required!');
        return;
    }

    // init request assets
    const assetsByRequest = {};
    const chunksJsExcludeEntry = [];
    const chunksJsEntry = [];
    chunks.forEach(item => {
        if(item.initial && !item.entry) {
            item.files.forEach(file => {
                if(isJsFile(file)) {
                    chunksJsExcludeEntry.push(file);
                }
            })
        }
        if(item.initial && item.entry) {
            item.files.forEach(file => {
                if(isJsFile(file)) {
                    chunksJsEntry.push(file);
                }
            })
        }
        if(!item.initial && !item.entry) {
            item.files.forEach(file => {
                if(isJsFile(file)) {
                    chunksJsExcludeEntry.push(file);
                }
            })

            const cssFiles = [];
            const jsFiles = [];

            item.files.forEach(file => {
                if(isJsFile(file)) {
                    jsFiles.push(file);
                }
                else if(isCssFile(file)) {
                    cssFiles.push(file);
                }
            })

            item.origins.forEach(origin => {
                const key = origin.request + origin.moduleId;
                if(!assetsByRequest[key]) {
                    assetsByRequest[key] = {
                        css: [],
                        js: [],
                    };
                }
                [].push.apply(assetsByRequest[key].css, cssFiles);
                [].push.apply(assetsByRequest[key].js, jsFiles);
            })
        }
    })

    // init 'initial and entry' assests;
    const assetsByEntry = {};
    Object.keys(entrypoints).forEach(entryKey => {
        const entry = entrypoints[entryKey];

        if(!assetsByEntry[entryKey]) {
            assetsByEntry[entryKey] = {
                css: [],
                js: []
            }
        }
        (entry.assets || []).forEach(asset => {
            if(!asset) return;
            // css file
            if(isCssFile(asset)) {
                assetsByEntry[entryKey].css.push(asset);
            }
            // js file
            else if(isJsFile(asset)) {
                assetsByEntry[entryKey].js.push(asset);
            }
        })
    })
    return {
        assetsByEntry,
        assetsByRequest,
        chunksJsExcludeEntry,
        chunksJsEntry,
        publicPath: stats.publicPath,
    }
}

function getAssets({ initedStats, requestText, entryPoint = 'main' } = {}) {
    if(!initedStats || (initedStats && (!initedStats.assetsByEntry || !initedStats.assetsByRequest))) {
        console.error('initedStats has some exception!:', initedStats);
        return;
    }

    let requestAssets = null;
    if(requestText) {
        Object.keys(initedStats.assetsByRequest).some(key => {
            if(0 === key.indexOf(requestText)) {
                requestAssets = initedStats.assetsByRequest[key];
                return;
            }
        })
    }
    const entryAssets = initedStats.assetsByEntry[entryPoint];

    if(!entryAssets) {
        console.warn(`entryPoint ${entryPoint}, assets not found!`);
    }
    if(!requestAssets) {
        console.warn(`request: ${requestText}, assets not found!`);
    }

    return {
        // css entry 的放前面
        cssFiles: [].concat(entryAssets ? entryAssets.css : [],  requestAssets ? requestAssets.css : []),
        // js entry 放后面，避免entry 去拉request的js
        jsFiles: [].concat(requestAssets ? requestAssets.js: [], entryAssets ? entryAssets.js: []),
    }
}

function getAssetsXMLString({initedStats, requestText, entryPoint='main', isPublicPrefix = true} = {}) {
    const assets = getAssets({ initedStats, requestText, entryPoint });
    let publicPath = '';
    if(isPublicPrefix) {
        publicPath = initedStats.publicPath;
    }

    return {
        js: assets.jsFiles.map(item => '<script src="'+ publicPath + item +'"></script>').join(''),
        css: assets.cssFiles.map(item => '<link href="'+ publicPath + item +'" rel="stylesheet" />').join('')
    }
}

function requireExcludeEntry(initedStats, root) {
    const chunksJs = initedStats.chunksJsExcludeEntry;
    console.log('requireExcludeEntry: ', chunksJs);

    if(chunksJs) {
        chunksJs.forEach(file => {
            if(root) {
                file = path.resolve(root, file);
            }
            if(fs.pathExistsSync(file)){
                require(file);
                console.log('success require chunk file:', file);
            }
            else {
                console.error('Not fount chunk file:', file);
            }
        })
    }
}

function requireEntry(initedStats, root) {
    const chunksJs = initedStats.chunksJsEntry;
    console.log('requireEntry: ', chunksJs);

    if(chunksJs.length > 1) {
        throw Error('no support mutil entry!');
    }
    if(chunksJs.length === 1) {
        let file = chunksJs[0]
        if(root) {
            file = path.resolve(root, file);
        }
        if(fs.pathExistsSync(file)){
            console.log('success require entry chunk file:', file);
            return require(file);
        }
        else {
            console.error('Not fount entry chunk file:', file);
        }
    }
    else {
        throw Error('entry chunk lose!');
    }
}

function requireAll(initedStats, root) {
    requireExcludeEntry(initedStats, root);
    return requireEntry(initedStats, root);
}

// require data {
//      matchResult,
//      jsTpl,
//      cssTpl,
//      pageContent
// }
function makeHtmlTpl(htmlPath) {
    if(typeof htmlPath !== 'string') {
        throw Error('htmlPath required!');
    }
    const preJs = `<script>window.isSSR=true;</script>`;
    const postJs = '<script>window.main(${this.matchResultStr});</script>';

    return fs.readFileSync(htmlPath, 'utf8')
        .replace(/(<script.*?>([\s\S]*?)<\/script>)|(<link.*?rel="stylesheet".*?\/?>)/img, '')
        .replace(/<div.*?id="root".*?>/img, '<div id="root">${this.pageContent}')
        .replace(/<\/body>/img, preJs + "${this.js}" + postJs + "</body>")
        .replace(/<\/head>/img, "${this.css}</head>")
}

function _fillTemplate(templateString, templateVars){
    return new Function("return `"+templateString +"`;").call(templateVars);
}

function getIndexHtmlByTpl({ htmlTpl, data = {} }) {
    return _fillTemplate(htmlTpl, data);
}

function getIndexHtml({ htmlTpl, matchResult, pageContent, initedStats } = {}) {
    const assets = getAssetsXMLString({ initedStats, requestText: matchResult.requestText });

    if(!htmlTpl) {
        return `
            <!doctype html>
            <html lang="en">
                <head>
                    ${assets.css}
                </head>
                <body>
                    <div id="root">${pageContent}</div>
                    <script>window.isSSR=true;</script>
                    ${assets.js}
                    <script>window.main(${JSON.stringify(matchResult)});</script>
                </body>
            </html>
        `;
    }

    return getIndexHtmlByTpl({ htmlTpl, data: {
        js: assets.js,
        css: assets.css,
        matchResultStr: JSON.stringify(matchResult),
        pageContent,
    }});
}

module.exports = {
    initStats,
    makeHtmlTpl,
    getIndexHtml,
    requireAll,
}

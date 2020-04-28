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

function assetsByFileType(assets = []) {
    const cssList = [];
    const jsList = [];

    assets.forEach(file => {
        if(isJsFile(file)) {
            jsList.push(file);
        }
        else if(isCssFile(file)) {
            cssList.push(file);
        }
    })
    return {
        js: jsList,
        css: cssList,
    }
}

function initStats(stats) {
    const { namedChunkGroups, chunks, publicPath } = stats;

    if(!namedChunkGroups) {
        console.error('in initStats, namedChunkGroups required!');
        return;
    }

    if(!chunks) {
        console.error('in initStats, chunks required!');
        return;
    }

    return {
        chunks,
        namedChunkGroups,
        publicPath,
    }
}

/**
 *  获取指定chunkName 或entryPoint的资源
 *  @initedStats [object] 必须 被初始化的资源
 *  @chunkName [string] 可选
 *  @entryPoint [string] 可选
 *  @return Object{cssFiles, jsFiles}
 */
function getAssets({ initedStats, chunkName, entryPoint } = {}) {
    if(!initedStats || (initedStats && (!initedStats.namedChunkGroups))) {
        throw Error('initedStats require namedChunkGroups');
    }

    const namedChunkGroups = initedStats.namedChunkGroups;

    let entryAssets = null;
    if(entryPoint && namedChunkGroups[entryPoint]) {
        entryAssets = assetsByFileType(namedChunkGroups[entryPoint].assets);
    }

    let chunkAssets = null;
    if(chunkName && namedChunkGroups[chunkName]) {
        chunkAssets = assetsByFileType(namedChunkGroups[chunkName].assets);
    }

    return {
        // css entry 的放前面
        cssFiles: [].concat(entryAssets ? entryAssets.css : [],  chunkAssets ? chunkAssets.css : []),
        // js entry 放后面，entry 会export模块
        jsFiles: [].concat(chunkAssets ? chunkAssets.js: [], entryAssets ? entryAssets.js: []),
    }
}

function getAssetsXMLString({initedStats, chunkName, entryPoint, isPublicPrefix = true} = {}) {
    const assets = getAssets({ initedStats, chunkName, entryPoint });
    let publicPath = '';
    if(isPublicPrefix) {
        publicPath = initedStats.publicPath;
    }

    return {
        js: assets.jsFiles.map(item => '<script src="'+ publicPath + item +'"></script>').join(''),
        css: assets.cssFiles.map(item => '<link href="'+ publicPath + item +'" rel="stylesheet" />').join('')
    }
}

/**
 *  批量加载js模块
 *  @root [string] 必须 资源所在根目录
 *  @jsAssets [array] 必须 文件列表
 */
function _requireJsSync(root, jsAssets) {
    let lastModule = null;
    if(jsAssets) {
        jsAssets.forEach(file => {
            if(root) {
                file = path.resolve(root, file);
            }
            if(fs.pathExistsSync(file)){
                lastModule = require(file);
                console.log('success require file:', file);
            }
            else {
                console.error('Not fount file:', file);
            }
        })
    }
    return lastModule;
}

/**
 *  加载指定入口js
 *  @initedStats [object] 必须 被初始化的资源
 *  @root [string] 必须 资源所在根目录
 *  @entryPoint [string] option 默认 main
 */
function requireEntryJs(initedStats, root, entryPoint = 'main') {
    const assets = getAssets({initedStats, entryPoint});
    return _requireJsSync(root, assets.jsFiles);
}

/**
 *  获取指定entry下所有child chunk的js
 *  @initedStats [object] 必须 被初始化的资源
 *  @entryPoint [string] option 默认 main
 */
function getAllChildChunkJsForEntry(initedStats, entryPoint = 'main') {
    if(!initedStats || (initedStats && (!initedStats.chunks || !initedStats.namedChunkGroups))) {
        throw Error('initedStats required chunks, namedChunkGroups child');
    }

    const namedChunkGroups = initedStats.namedChunkGroups;
    const chunks = initedStats.chunks;

    const entry = namedChunkGroups[entryPoint];
    if(!entry) {
        throw Error('not found entry from initedStats')
    }

    // find childChunkIds from entry
    let childrenChunkIds = null;
    const entryChunkIds = entry.chunks;
    entryChunkIds.some(chunkId => {
        const entryChunk = chunks[chunkId];
        if(entryChunk && entryChunk.entry === true) {
            childrenChunkIds = entryChunk.children;
            return true;
        }
    })

    let jsFiles = []
    let walkChunkNameList = [];
    if(childrenChunkIds) {
        childrenChunkIds.forEach(chunkId => {
            const childChunk = chunks[chunkId];
            if(childChunk && childChunk.files && childChunk.names) {
                childChunk.files.forEach(file => {
                    if(isJsFile(file)) {
                        jsFiles.push(file);
                    }
                })

                childChunk.names.forEach(name => {
                    walkChunkNameList.push(name);
                })
            }
        })
    }

    return {
        jsFiles,
        walkChunkNameList
    }
}

/**
 *  加载指定entry下所有child chunk的js
 *  @initedStats [object] 必须 被初始化的资源
 *  @root [string] 必须 资源所在根目录
 *  @entryPoint [string] option 默认 main
 */
function requireAllChildChunkJsForEntry(initedStats, root, entryPoint = 'main') {
    const assets = getAllChildChunkJsForEntry(initedStats, entryPoint);
    _requireJsSync(root, assets.jsFiles)
    console.log('require all chunkName:', assets.walkChunkNameList.join(','));
}

/**
 *  加载指定入口js和入口下所有chunk的js
 *  @initedStats [object] 必须 被初始化的资源
 *  @root [string] 必须 资源所在根目录
 *  @entryPoint [string] option 默认 main
 */
function requireAll(initedStats, root, entryPoint = 'main') {
    requireAllChildChunkJsForEntry(initedStats, root);
    return requireEntryJs(initedStats, root);
}

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
    const assets = getAssetsXMLString({ initedStats, chunkName: matchResult.chunkName, entryPoint: 'main' });

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
    getAssets,
    getAssetsXMLString,
    requireAll,
}

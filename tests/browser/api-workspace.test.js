'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
const {chromium,expect}=require('@playwright/test');
test('API editor preserves raw drafts across hide/reload and drives shared request workflows',async t=>{
  const toolkit=path.resolve(__dirname,'../..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'devkit-api-browser-'));
  let page,browser,html,receive,panels=0,reveals=0,options;const errors=[],commands=new Map();
  const uri=file=>({fsPath:file,toString:()=>file});
  const server=http.createServer(async(req,res)=>{
    if(req.url.startsWith('/media/')){res.setHeader('content-type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(path.join(toolkit,req.url.slice(1))));return;}
    if(req.url.startsWith('/echo')){const chunks=[];for await(const chunk of req)chunks.push(chunk);res.setHeader('content-type','application/json');res.setHeader('set-cookie','browser=fixture; Path=/');res.end(JSON.stringify({url:req.url,body:Buffer.concat(chunks).toString(),headers:req.headers}));return;}
    res.setHeader('content-type','text/html');res.end(html);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  const disposable=()=>({dispose(){}}),vscode={ThemeIcon:class{},ViewColumn:{One:1},Uri:{file:uri,joinPath:(base,...parts)=>uri(path.join(base.fsPath,...parts))},
    workspace:{isTrusted:true,workspaceFolders:[{uri:uri(root)}],registerTextDocumentContentProvider:disposable,onDidCloseTextDocument:disposable},
    commands:{registerCommand:(name,fn)=>{commands.set(name,fn);return disposable();}},
    window:{registerTreeDataProvider:disposable,showErrorMessage:message=>errors.push(message),showSaveDialog:async()=>uri(path.join(root,'response.bin')),createWebviewPanel:(_id,_title,_column,value)=>{panels++;options=value;return {reveal:()=>reveals++,onDidDispose(){},webview:{cspSource:'http:',asWebviewUri:value=>({toString:()=>'/media/'+path.basename(value.fsPath)}),set html(value){html=value;},postMessage:message=>page?.evaluate(value=>window.dispatchEvent(new MessageEvent('message',{data:value})),message),onDidReceiveMessage:fn=>receive=fn}};}}
  };
  const original=Module._load;
  try {
    Module._load=function(id,...args){return id==='vscode'?vscode:id.endsWith('/build/sftp/extension')?{activate:async()=>{},deactivate(){}}:original.call(this,id,...args);};
    const {activate}=require('../../src/interface/extension');activate({subscriptions:[],extensionPath:toolkit,extensionUri:uri(toolkit),secrets:{get:async()=>undefined}});
    await commands.get('devkit.open')();await commands.get('devkit.open')();assert.equal(panels,1);assert.equal(reveals,1);assert.equal(options.retainContextWhenHidden,true);
    browser=await chromium.launch({channel:process.env.DEVKIT_BROWSER||'msedge',headless:true});page=await browser.newPage({viewport:{width:1280,height:960}});
    page.on('pageerror',error=>errors.push(error.message));
    await page.exposeFunction('bridge',message=>receive(message));await page.addInitScript(()=>{window.acquireVsCodeApi=()=>({postMessage:message=>window.bridge(message)});});
    await page.goto(base);await page.locator('#url').fill(base+'/echo');
    await page.locator('[aria-label="query name 1"]').fill('q');await page.locator('[aria-label="query value 1"]').fill('hello');
    await page.locator('[data-tab="body"]').click();await page.locator('#bodyType').selectOption('json');await page.locator('#body').fill('{"draft":');
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.reload();await expect(page.locator('#notice')).toContainText('draft restored');await expect(page.locator('#body')).toHaveValue('{"draft":');await expect(page.locator('#url')).toHaveValue(base+'/echo');
    await page.locator('#body').fill('{"draft":true}');await page.locator('#method').selectOption('POST');
    await page.locator('#body').fill('{"id":900719925474099312345}');await page.locator('#formatBody').click();await expect(page.locator('#body')).toHaveValue(/900719925474099312345/);
    await page.locator('#bodyType').selectOption('graphql');await page.locator('#body').fill('query Q { item { id } }');await page.locator('#graphqlVariables').fill('{"id":42}');
    await page.locator('#bodyType').selectOption('json');await expect(page.locator('#body')).toHaveValue(/900719925474099312345/);
    await page.locator('[data-tab="headers"]').click();await page.locator('#rawHeaders').check();await page.locator('#headers').fill('Accept: application/json\nX-fixture: raw');
    await page.reload();await expect(page.locator('#notice')).toContainText('draft restored');await expect(page.locator('#headers')).toBeVisible();await expect(page.locator('#headers')).toHaveValue('Accept: application/json\nX-fixture: raw');await page.locator('#rawHeaders').uncheck();await expect(page.locator('[aria-label="headers name 2"]')).toHaveValue('X-fixture');
    await page.locator('[data-tab="auth"]').click();await page.locator('#authType').selectOption('basic');await page.locator('[data-auth="username"]').fill('fixture');await page.locator('[data-auth="password"]').fill('ephemeral-fixture');
    await page.locator('#authType').selectOption('none');await page.locator('#authType').selectOption('basic');await expect(page.locator('[data-auth="password"]')).toHaveValue('ephemeral-fixture');
    await page.locator('#send').click();await expect(page.locator('#notice')).toContainText('Completed successfully');await expect(page.locator('#response')).toContainText('/echo?q=hello');
    await page.locator('[data-view="cookies"]').click();await expect(page.locator('#response')).toContainText('browser');
    await page.locator('[data-view="docs"]').click();await page.locator('#editDocs').click();await page.locator('#documentation').fill('Request notes <script>not executable</script>');await page.locator('#editDocs').click();
    await page.locator('[data-tab="tests"]').click();await page.locator('#addTest').click();await expect(page.locator('#testRows')).toContainText('status');
    await page.locator('[data-tab="preRun"]').click();await page.locator('#addPreRequest').click();await page.locator('[aria-label="Collection 1"]').selectOption({label:'My collection'});await expect(page.locator('[aria-label="Request 1"]')).toBeVisible();
    await page.locator('#new').click();await page.locator('#name').fill('Setup');await page.locator('#url').fill(base+'/echo?setup=1');
    await page.locator('#send').click();await expect(page.locator('#notice')).toContainText('Completed successfully');
    await page.locator('.request-item').filter({hasText:'New request'}).click();await page.locator('[aria-label="Request 1"]').selectOption({label:'Setup'});
    await page.locator('#download').click();await expect.poll(()=>fs.existsSync(path.join(root,'response.bin'))).toBe(true);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'response.bin'),'utf8')).url,'/echo?q=hello');fs.unlinkSync(path.join(root,'response.bin'));
    await page.locator('#send').click();await expect(page.locator('#notice')).toContainText('Completed successfully');await page.locator('[data-view="tests"]').click();await expect(page.locator('#response')).toContainText('Setup');
    const originalCollection=await page.locator('#activeCollection').inputValue();await page.locator('.request-item').filter({hasText:'Setup'}).click();await page.locator('#delete').click();
    await page.reload();await expect(page.locator('#notice')).toContainText('draft restored');await expect(page.locator('#undoDelete')).toBeEnabled();
    const other={version:1,id:'other',name:'Other',requests:[{id:'other-request',name:'Other request',url:base+'/echo'}]};
    await page.evaluate(value=>window.dispatchEvent(new MessageEvent('message',{data:{type:'collection',collection:value,warnings:[]}})),other);
    await page.locator('#undoDelete').click();await expect(page.locator('#activeCollection')).toHaveValue(originalCollection);await expect(page.locator('.request-item').filter({hasText:'Setup'})).toHaveCount(1);
    await page.locator('#activeCollection').selectOption('other');await expect(page.locator('.request-item').filter({hasText:'Setup'})).toHaveCount(0);
    await page.evaluate(value=>window.dispatchEvent(new MessageEvent('message',{data:{type:'collection',collection:value,warnings:[]}})),other);
    const ids=await page.locator('#activeCollection option').evaluateAll(items=>items.map(item=>item.value));assert.equal(new Set(ids).size,ids.length);
    await page.screenshot({path:path.join(toolkit,'dist/api-workspace-browser.png'),fullPage:true});
    await page.setViewportSize({width:560,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    assert.deepEqual(errors,[]);assert.equal(fs.readdirSync(root).length,0,'drafts and credentials never persisted to the project');
  }finally{Module._load=original;await browser?.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});}
});

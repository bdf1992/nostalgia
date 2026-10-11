import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ReadBuffer,STDIO_DEFAULT_MAX_BUFFER_SIZE} from '@modelcontextprotocol/server';
import {presentGameplayObservation,GAMEPLAY_MCP_PRESENTATION_LIMIT} from '../dist/gameplayMcpPresentation.js';
import {nativeInspectOutput,nativeActOutput,nativeFocusOutput} from '../dist/nativeGameplayEnvironment.js';

function observation(data){return {provider:'windows-native',session_path:'C:/fixture/session.json',session_id:'5d460285-189f-4b01-a2d9-645d6ecbd1a3',checkpoint_id:'cp_'+'a'.repeat(64),status:'running',url:'http://127.0.0.1:1',visible_text:'authored presentation fixture',screenshot_image_base64:data,screenshot_png_base64:data,screenshot_mime_type:'image/png',window:{id:99,app:'process:C:/fixture/eldenring.exe'},screenshots:[{id:'actual-retained-frame',url:'data:image/png;base64,'+data,width:1,height:1,zIndex:0}],input_behavior:'owned-hidden-desktop-virtual-input'};}
const action={kind:'gamepad',connected:true,buttons:4096,left_trigger:0,right_trigger:0,left_x:0,left_y:0,right_x:0,right_y:0,lease_ms:100};
test('representative 6.7MB base64 frame occurs once and passes the default SDK transport bound',()=>{
 const data='A'.repeat(6677544),source=observation(data),before=JSON.stringify(source),result=presentGameplayObservation(source),wire=JSON.stringify({jsonrpc:'2.0',id:1,result})+'\n';
 assert.equal(result.content.filter(c=>c.type==='image').length,1);assert.equal(result.content.find(c=>c.type==='image').data,data);assert.equal(wire.split(data).length-1,1);assert.equal(JSON.stringify(source),before);nativeInspectOutput.parse(result.structuredContent);
 assert.ok(Buffer.byteLength(wire)<GAMEPLAY_MCP_PRESENTATION_LIMIT);assert.equal(STDIO_DEFAULT_MAX_BUFFER_SIZE,10*1024**2);const buffer=new ReadBuffer();buffer.append(Buffer.from(wire));assert.equal(buffer.readMessage().result.content.find(c=>c.type==='image').data,data);
});
test('focus and act projections preserve schemas and original nested observations',()=>{
 for(const source of [{focused:true,observation:observation('AAAA')},{action,observation:observation('AAAA')}]){const original=JSON.stringify(source),result=presentGameplayObservation(source);assert.equal(result.content.filter(c=>c.type==='image').length,1);assert.equal(result.structuredContent.observation.screenshot_image_base64,'');assert.equal(result.structuredContent.observation.screenshot_png_base64,'');assert.equal(result.structuredContent.observation.screenshots[0].url,'');assert.equal(JSON.stringify(source),original);(source.focused?nativeFocusOutput:nativeActOutput).parse(result.structuredContent);}
});
test('oversize actual image is explicitly omitted with retained-evidence notice and bounded metadata',()=>{
 const source=observation('A'.repeat(10*1024**2)),result=presentGameplayObservation(source);assert.equal(result.content.some(c=>c.type==='image'),false);assert.match(result.content.at(-1).text,/Actual frame omitted.*full frame remains in retained session evidence/);assert.ok(Buffer.byteLength(JSON.stringify(result))<GAMEPLAY_MCP_PRESENTATION_LIMIT);assert.equal(source.screenshot_image_base64.length,10*1024**2);nativeInspectOutput.parse(result.structuredContent);
});
test('browser presentation preserves empty-frame stopped output and emits an existing image once',()=>{
 const source={session_path:'C:/fixture/session.json',screenshot_png_base64:'AAAA'};const result=presentGameplayObservation(source);assert.equal(result.structuredContent.screenshot_png_base64,'');assert.equal(result.content.find(c=>c.type==='image').mimeType,'image/png');assert.equal(source.screenshot_png_base64,'AAAA');assert.equal(presentGameplayObservation({...source,screenshot_png_base64:''}).content.some(c=>c.type==='image'),false);
});
test('metadata that cannot fit fails without changing retained source',()=>{const source={screenshot_png_base64:'AAAA',visible_text:'X'.repeat(GAMEPLAY_MCP_PRESENTATION_LIMIT)};assert.throws(()=>presentGameplayObservation(source),e=>e.code==='gameplay_mcp_limit');assert.equal(source.screenshot_png_base64,'AAAA');});

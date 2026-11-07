import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import SwaggerParser from '@apidevtools/swagger-parser';
import {Parser} from '@asyncapi/parser';
import YAML from 'yaml';
const contracts='docs/contracts';
const operations=new Set();
for(const name of (await readdir(contracts)).filter(n=>n.endsWith('.openapi.yaml'))){
 const api=await SwaggerParser.validate(`${contracts}/${name}`);
 for(const [url,item] of Object.entries(api.paths)){
  for(const method of ['get','post','put','delete','patch']){
   const op=item[method];if(!op)continue;
   assert(!operations.has(op.operationId),`Duplicate operationId ${op.operationId}`);operations.add(op.operationId);
   if(['post','put','patch','delete'].includes(method)&&!url.startsWith('/webhooks/')&&!url.startsWith('/demo/')){
    assert(op.parameters?.some(p=>p.name==='Idempotency-Key'&&p.required),`Missing key: ${name} ${url}`);
   }
  }
 }
 console.log(`OpenAPI OK: ${name}`);
}
const asyncText=await readFile(`${contracts}/events.asyncapi.yaml`,'utf8');
// Version 2.6 is intentional; this project does not invent a distribution license.
const {document,diagnostics}=await new Parser({ruleset:{rules:{'asyncapi-info-license':'off','asyncapi-latest-version':'off'}}}).parse(asyncText);
const errors=diagnostics.filter(d=>d.severity===0);
if(errors.length)console.error(errors);
assert(document&&errors.length===0,'AsyncAPI validation failed');
const asyncDoc=YAML.parse(asyncText);
assert.equal(Object.keys(asyncDoc.channels).length,10);
for(const [channel,c] of Object.entries(asyncDoc.channels)){
 const direction=c['x-producer']==='Orders'?'publish':'subscribe';
 assert(c[direction],`Incorrect Orders direction: ${channel}`);
 const name=c[direction].message.$ref.split('/').pop();
 const message=asyncDoc.components.messages[name];
 for(const example of message.examples){
  assert.equal(example.payload.eventType,name);
  assert.equal(example.payload.correlationId,example.payload.data.orderId);
  const idField={'Reservations':'reservationId','Payments':'paymentId','Orders':'orderId'}[c['x-producer']];
  assert.equal(example.payload.aggregateId,example.payload.data[idField]);
 }
}
console.log(`AsyncAPI OK: 10 messages, ${diagnostics.length} non-error diagnostics`);
async function walk(dir){
 const result=[];
 for(const f of await readdir(dir,{withFileTypes:true})){
  if(f.name==='node_modules'||f.name==='.git')continue;
  const p=path.join(dir,f.name);result.push(...(f.isDirectory()?await walk(p):[p]));
 }
 return result;
}
for(const file of (await walk('.')).filter(f=>f.endsWith('.md'))){
 const body=await readFile(file,'utf8');
 for(const match of body.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)){
  const target=match[1].split('#')[0];
  if(!target||/^https?:|^mailto:/.test(target))continue;
  await stat(path.resolve(path.dirname(file),target));
 }
 for(const match of body.matchAll(/<!-- diagram:([\w-]+) -->\s*```mermaid\n([\s\S]*?)```/g)){
  const source=(await readFile(`docs/diagrams/${match[1]}.mmd`,'utf8')).trim();
  assert.equal(match[2].trim(),source,`Stale diagram in ${file}`);
 }
 assert(!/<!-- diagram:[\w-]+ -->\s*(?!```mermaid)\[/.test(body),`Unrendered diagram in ${file}`);
}
const diagrams=(await readdir('docs/diagrams')).filter(n=>n.endsWith('.mmd'));
for(const diagram of diagrams){
 const svg=await readFile(`docs/images/${diagram.replace(/\.mmd$/,'.svg')}`,'utf8');
 assert(svg.includes('<svg'),'Missing SVG');
 assert(!svg.includes('Syntax error in text'),'Invalid Mermaid rendering');
}
assert.equal(diagrams.length,9);
console.log(`Documentation OK: links, ${operations.size} HTTP operations, 9 synchronized diagrams.`);

import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=process.cwd();
const sources=(await readdir('docs/diagrams')).filter(n=>n.endsWith('.mmd')).sort();
await mkdir('docs/images',{recursive:true});
for(const name of sources){
 const src=`docs/diagrams/${name}`;
 const dest=`docs/images/${name.replace(/\.mmd$/,'.svg')}`;
 const args=['-i',src,'-o',dest,'-c','docs/tools/mermaid-config.json','-b','white','-w','1800'];
 if(process.env.MERMAID_NO_SANDBOX==='1')args.push('-p','docs/tools/puppeteer-config.json');
 const run=spawnSync(path.join(root,'node_modules/.bin/mmdc'),args,{stdio:'inherit'});
 if(run.status!==0)process.exit(run.status||1);
}
for(const name of (await readdir('docs')).filter(n=>n.endsWith('.md'))){
 const p=`docs/${name}`;
 let body=await readFile(p,'utf8');
 const matches=[...body.matchAll(/<!-- diagram:([\w-]+) -->/g)];
 for(const m of matches){
  const source=(await readFile(`docs/diagrams/${m[1]}.mmd`,'utf8')).trim();
  const escaped=m[1].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const block=new RegExp(`<!-- diagram:${escaped} -->(?:\\s*\x60\x60\x60mermaid[\\s\\S]*?\x60\x60\x60)?`,'g');
  body=body.replace(block,`<!-- diagram:${m[1]} -->\n\n\x60\x60\x60mermaid\n${source}\n\x60\x60\x60`);
 }
 await writeFile(p,body);
}
console.log(`Rendered ${sources.length} diagrams and synchronized Markdown.`);

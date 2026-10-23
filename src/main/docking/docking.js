export class DockingEngine {
  constructor() {
    this.key = "miasquid.docking.layout.v1";
    this.nextId = 1;
    this.defs = new Map([
      ["editor", { title: "Editor", icon: "🦑" }],
      ["terminal", { title: "Terminal", icon: "▤" }]
    ]);
    this.drag = null;
    this.documents = new Map();
    this.activeDocumentId = null;
  }
  defaultLayout() {
    return { type: "leaf", id: "editor-main", panels: ["editor"], active: "editor" };
  }
  initialize() {
    this.root = this.load() || this.defaultLayout();
    this.render();
    window.addEventListener("beforeunload", () => this.save());
  }
  load() {
    try {
      const v = JSON.parse(localStorage.getItem(this.key));
      const valid = n => n && (n.type === "leaf" ? Array.isArray(n.panels) : n.type === "split" && Array.isArray(n.children) && n.children.every(valid));
      return valid(v) ? v : null;
    } catch { return null; }
  }
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.root)); } catch (e) { console.warn("Dock layout could not be saved", e); } }
  find(id, node=this.root, parent=null) {
    if (!node) return null;
    if (node.id === id) return { node, parent };
    if (node.type === "split") for (const child of node.children) { const found=this.find(id,child,node); if(found)return found; }
    return null;
  }
  leafFor(panel, node=this.root) {
    if (node.type === "leaf" && node.panels.includes(panel)) return node;
    if (node.type === "split") for (const child of node.children) { const found=this.leafFor(panel,child); if(found)return found; }
    return null;
  }
  addPanel(panel) {
    if(this.leafFor(panel))return;
    const editor=this.leafFor("editor");
    if(!editor)return;
    const replacement={type:"split",id:"split-"+this.nextId++,axis:"vertical",sizes:[72,28],children:[
      {...editor,panels:[...editor.panels]},
      {type:"leaf",id:`${panel}-${this.nextId++}`,panels:[panel],active:panel}
    ]};
    const found=this.find(editor.id);
    if(!found.parent)this.root=replacement;
    else found.parent.children[found.parent.children.findIndex(child=>child.id===editor.id)]=replacement;
    this.save();
    this.render();
  }
  removePanel(panel) {
    const leaf=this.leafFor(panel);
    if(!leaf)return;
    leaf.panels=leaf.panels.filter(item=>item!==panel);
    if(leaf.active===panel)leaf.active=leaf.panels[0]||null;
    this.prune(this.root);
    this.save();
    this.render();
  }
  closeAllDocuments() {
    this.documents.clear();
    this.activeDocumentId=null;
    this.editorTemplate=null;
    const editor=document.querySelector(".editor-content");
    const tabs=document.querySelector(".editor-tabs");
    tabs?.querySelectorAll(".editor-tab").forEach(tab=>tab.remove());
    if(editor)editor.innerHTML='<div class="welcome-view"><div class="welcome-logo">🦑</div><h1>Welcome to <span>MiaSquid IDE</span></h1><p>Your workspace. Your tools. Your way.</p></div>';
    this.render();
    window.dispatchEvent(new Event("miasquid:active-document"));
  }
  render() {
    const host=document.getElementById("editor-host");
    if (!host) return;
    window.dispatchEvent(new Event("miasquid:terminals-unmount"));
    const currentContent=host.querySelector(".editor-content");
    const currentTabs=host.querySelector(".editor-tabs");
    if(currentContent) {
      this.editorTemplate=document.createElement("div");
      this.editorTemplate.className="editor-template";
      if(currentTabs)this.editorTemplate.append(currentTabs.cloneNode(true));
      this.editorTemplate.append(currentContent.cloneNode(true));
    }
    host.innerHTML="";
    host.classList.add("dock-zone");
    this.renderNode(this.root,host);
    this.bindTabs(host); this.bindSplitters(host);
    host.querySelectorAll(".editor-tab").forEach(tab=>this.bindEditorTab(tab));
    if(this.activeDocumentId)this.renderActiveDocument();
    window.dispatchEvent(new Event("miasquid:terminals-mount"));
  }
  renderNode(node, parent) {
    if(node.type==="split") {
      parent.dataset.axis=node.axis;
      node.children.forEach((child,i)=>{
        const el=document.createElement("div");
        el.className=child.type==="split"?"dock-zone":"dock-leaf";
        el.dataset.nodeId=child.id;
        el.style.flexBasis=(node.sizes?.[i] ?? 100/node.children.length)+"%";
        el.style.flexGrow="0"; el.style.flexShrink="0";
        this.renderNode(child,el); parent.append(el);
        if(i<node.children.length-1) {
          const bar=document.createElement("div");
          bar.className="dock-splitter "+(node.axis==="horizontal"?"horizontal":"vertical");
          bar.dataset.parent=node.id; bar.dataset.index=i; parent.append(bar);
        }
      });
      return;
    }
    parent.classList.add("dock-leaf"); parent.dataset.nodeId=node.id;
    const header=document.createElement("div"); header.className="dock-leaf-header";
    node.panels.forEach(id=>{
      const def=this.defs.get(id)||{title:id,icon:"□"};
      const tab=document.createElement("button"); tab.className="dock-leaf-tab"+(node.active===id?" active":"");
      tab.draggable=true; tab.dataset.panel=id; tab.dataset.leaf=node.id; tab.textContent=def.icon+" "+def.title; header.append(tab);
    });
    const body=document.createElement("div"); body.className="dock-leaf-body";
    if(node.active==="editor") {
      const content=document.createElement("div"); content.className="dock-panel-content";
      const source = this.editorTemplate ? this.editorTemplate.cloneNode(true) : document.createElement("div");
      if (source && source.nodeType === 1) {
        content.append(source);
      } else {
        content.innerHTML='<div class="welcome-view"><div class="welcome-logo">🦑</div><h1>Welcome to <span>MiaSquid IDE</span></h1><p>Your workspace. Your tools. Your way.</p></div>';
      }
      body.append(content);
    } else if(node.active==="terminal") {
      const content=document.createElement("div"); content.className="dock-panel-content";
      content.innerHTML='<div class="terminal-view"></div>'; body.append(content);
    } else body.innerHTML='<div class="dock-empty">Empty panel</div>';
    parent.append(header,body);
  }
  bindTabs(host) {
    host.querySelectorAll(".dock-leaf-tab").forEach(tab=>{
      tab.addEventListener("click",()=>{const found=this.find(tab.dataset.leaf);if(found){found.node.active=tab.dataset.panel;this.save();this.render();}});
      tab.addEventListener("dragstart",e=>{this.drag={panel:tab.dataset.panel,source:tab.dataset.leaf};e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",tab.dataset.panel);});
      tab.addEventListener("dragover",e=>{if(!this.drag)return;e.preventDefault();const r=tab.getBoundingClientRect(),o=document.getElementById("drop-overlay");Object.assign(o.style,{left:r.left+"px",top:r.top+"px",width:r.width+"px",height:r.height+"px"});o.classList.add("visible");});
      tab.addEventListener("drop",e=>{e.preventDefault();if(this.drag)this.movePanel(this.drag.panel,tab.dataset.leaf,tab.dataset.panel);document.getElementById("drop-overlay").classList.remove("visible");});
      tab.addEventListener("dragend",()=>{this.drag=null;document.getElementById("drop-overlay").classList.remove("visible");});
    });
  }
  movePanel(panel,targetId,beforeId) {
    const targetFound=this.find(targetId); if(!targetFound||targetFound.node.type!=="leaf")return;
    const source=this.leafFor(panel);
    if(source){source.panels=source.panels.filter(x=>x!==panel);if(source.active===panel)source.active=source.panels[0]||null;}
    const target=targetFound.node;
    target.panels=target.panels.filter(x=>x!==panel);
    const index=target.panels.indexOf(beforeId);
    target.panels.splice(index<0?target.panels.length:index,0,panel);target.active=panel;
    this.prune(this.root);this.save();this.render();
  }
  prune(node) {
    if(node.type!=="split")return;
    node.children.forEach(child=>this.prune(child));
    node.children=node.children.filter(child=>child.type!=="leaf"||child.panels.length);
    if(node.children.length===1) {
      const only=node.children[0];
      node.type=only.type;
      for(const key of Object.keys(node))if(!["id","type"].includes(key))delete node[key];
      for(const [key,value] of Object.entries(only))if(!["id","type"].includes(key))node[key]=value;
    }
  }
  splitEditor() {
    const old=this.leafFor("editor"); if(!old)return;
    const replacement={type:"split",id:"split-"+this.nextId++,axis:"horizontal",sizes:[50,50],children:[
      {...old,panels:[...old.panels]}, {type:"leaf",id:"editor-split-"+this.nextId++,panels:["editor"],active:"editor"}
    ]};
    const found=this.find(old.id);
    if(!found.parent)this.root=replacement;
    else found.parent.children[found.parent.children.findIndex(x=>x.id===old.id)]=replacement;
    this.save();this.render();
  }
  bindSplitters(host) {
    host.querySelectorAll(".dock-splitter").forEach(bar=>{
      bar.addEventListener("pointerdown",e=>{
        const found=this.find(bar.dataset.parent);if(!found)return;
        const parent=found.node,index=Number(bar.dataset.index),a=bar.previousElementSibling,b=bar.nextElementSibling;
        const horizontal=parent.axis==="horizontal",ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();
        this.resize={bar,parent,index,start:horizontal?e.clientX:e.clientY,a:horizontal?ra.width:ra.height,b:horizontal?rb.width:rb.height,horizontal};
        bar.setPointerCapture(e.pointerId);bar.classList.add("dragging");document.body.classList.add("is-resizing");if(!horizontal)document.body.classList.add("vertical-resize");
      });
      bar.addEventListener("pointermove",e=>{
        const d=this.resize;if(!d||d.bar!==bar)return;
        const delta=(d.horizontal?e.clientX:e.clientY)-d.start,total=d.a+d.b;
        const a=Math.max(90,Math.min(total-90,d.a+delta)),b=total-a;
        d.parent.sizes[d.index]=a/total*100;d.parent.sizes[d.index+1]=b/total*100;
        bar.previousElementSibling.style.flexBasis=d.parent.sizes[d.index]+"%";
        bar.nextElementSibling.style.flexBasis=d.parent.sizes[d.index+1]+"%";
      });
      const end=()=>{if(this.resize?.bar!==bar)return;bar.classList.remove("dragging");document.body.classList.remove("is-resizing","vertical-resize");this.resize=null;this.save();};
      bar.addEventListener("pointerup",end);bar.addEventListener("pointercancel",end);
    });
  }
  newFile() {
    const name="Untitled-"+Date.now().toString().slice(-4)+".txt";
    this.openFile(name,"",null,`untitled-${Date.now()}`);
  }
  openFile(name,content="",filePath=null,documentId=filePath) {
    const id=documentId||`document-${Date.now()}-${this.documents.size}`;
    let doc=this.documents.get(id);
    if(!doc) {
      doc={id,name,path:filePath,content,dirty:false};
      this.documents.set(id,doc);
    } else if(!doc.dirty) {
      doc.name=name;doc.path=filePath;doc.content=content;
    }
    this.activeDocumentId=id;
    this.renderActiveDocument();
    const tabs=document.querySelector(".editor-tabs");
    if(tabs) {
      let tab=[...tabs.querySelectorAll(".editor-tab")].find(item=>item.dataset.docId===id);
      if(!tab) {
        tab=document.createElement("div");tab.className="editor-tab";tab.setAttribute("role","tab");tab.tabIndex=0;tab.draggable=true;tab.dataset.docId=id;
        const icon=document.createElement("span");icon.textContent="📄";
        const label=document.createElement("span");label.className="tab-label";
        const close=document.createElement("button");close.className="tab-close";close.type="button";close.setAttribute("aria-label",`Close ${name} tab`);close.textContent="×";
        tab.append(icon,label,close);
        tabs.insertBefore(tab,tabs.querySelector(".editor-tab-spacer"));
      }
      tab.dataset.tabId=name;
      tab.querySelector(".tab-label").textContent=name+(doc.dirty?" ●":"");
      tabs.querySelectorAll(".editor-tab").forEach(item=>item.classList.toggle("active",item===tab));
    }
    this.render();
  }
  renderActiveDocument() {
    const doc=this.getActiveDocument();
    const editors=document.querySelectorAll(".editor-content");
    if(!editors.length||!doc)return;
    for(const editor of editors) {
    editor.replaceChildren();
    const workspace=document.createElement("div");
    workspace.className="editor-workspace";
    const gutter=document.createElement("div");
    gutter.className="editor-gutter";
    gutter.setAttribute("aria-hidden","true");
    const surface=document.createElement("div");
    surface.className="editor-surface";
    const highlight=document.createElement("pre");
    highlight.className="editor-highlight";
    highlight.setAttribute("aria-hidden","true");
    const code=document.createElement("code");
    highlight.append(code);
    const area=document.createElement("textarea");
    area.className="editor-textarea";area.spellcheck=false;area.dataset.docId=doc.id;area.value=doc.content;
    area.setAttribute("aria-label",doc.name);
    area.wrap="off";
    const inlineDiagnostic=document.createElement("div");
    inlineDiagnostic.className="editor-inline-diagnostic";
    const update = () => {
      const lines=area.value.split("\n");
      gutter.replaceChildren();
      const currentLine=area.value.slice(0,area.selectionStart).split("\n").length;
      const diagnostics=doc.diagnostics||[];
      for(let index=0;index<lines.length;index++) {
        const line=document.createElement("div");
        line.className="editor-gutter-line";
        line.textContent=String(index+1);
        const diagnostic=diagnostics.find(item=>item.line===index+1);
        if(diagnostic) {
          line.classList.add(diagnostic.severity);
          line.title=diagnostic.message;
        }
        gutter.append(line);
      }
      const inline=diagnostics.find(item=>item.line===currentLine);
      inlineDiagnostic.textContent=inline ? `${inline.severity.toUpperCase()} · ${inline.message} (Ln ${inline.line}, Col ${inline.column})` : "";
      inlineDiagnostic.hidden=!inline;
      const extension=doc.name.split(".").pop()?.toLowerCase();
      const languages={js:"javascript",mjs:"javascript",cjs:"javascript",ts:"typescript",tsx:"typescript",jsx:"javascript",html:"xml",svg:"xml",css:"css",json:"json",md:"markdown",py:"python",sh:"bash",ps1:"powershell",yml:"yaml",yaml:"yaml",xml:"xml",java:"java",c:"c",h:"c",cpp:"cpp",cs:"csharp",go:"go",rs:"rust",sql:"sql"};
      const language=languages[extension];
      try {
        const highlighted=window.hljs && area.value.length < 500000
          ? (language && window.hljs.getLanguage(language)
            ? window.hljs.highlight(area.value,{language}).value
            : window.hljs.highlightAuto(area.value).value)
          : null;
        code.innerHTML=highlighted ?? area.value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
      } catch (error) {
        console.error("Syntax highlighting failed",error);
        code.textContent=area.value;
      }
      code.append(document.createTextNode("\n"));
    };
    update();
    area.addEventListener("input",update);
    area.addEventListener("miasquid-analysis",update);
    area.addEventListener("keyup",update);
    area.addEventListener("click",update);
    area.addEventListener("scroll",()=>{
      highlight.scrollTop=area.scrollTop;
      highlight.scrollLeft=area.scrollLeft;
      gutter.scrollTop=area.scrollTop;
    });
    surface.append(highlight,area);
    workspace.append(gutter,surface,inlineDiagnostic);
    editor.append(workspace);
    }
    window.dispatchEvent(new CustomEvent("miasquid:active-document",{detail:{id:doc.id,name:doc.name,path:doc.path}}));
  }
  getActiveDocument() { return this.documents.get(this.activeDocumentId)||null; }
  getDocument(id) { return this.documents.get(id)||null; }
  hasUnsavedDocuments() { return [...this.documents.values()].some(doc=>doc.dirty||!doc.path); }
  discardUnsavedDocuments() {
    for(const [id,doc] of this.documents) {
      if(doc.dirty||!doc.path) {
        this.documents.delete(id);
        document.querySelectorAll(".editor-tab").forEach(tab=>{
          if(tab.dataset.docId===id)tab.remove();
        });
      }
    }
    if(!this.documents.has(this.activeDocumentId)) {
      this.activeDocumentId=this.documents.keys().next().value||null;
    }
    if(this.activeDocumentId) {
      this.renderActiveDocument();
      document.querySelectorAll(".editor-tab").forEach(tab=>
        tab.classList.toggle("active",tab.dataset.docId===this.activeDocumentId));
    } else {
      const editor=document.querySelector(".editor-content");
      if(editor)editor.innerHTML='<div class="welcome-view"><div class="welcome-logo">🦑</div><h1>Welcome to <span>MiaSquid IDE</span></h1><p>Your workspace. Your tools. Your way.</p></div>';
    }
    this.render();
  }
  setDocumentDirty(id,dirty) {
    const doc=this.documents.get(id);if(!doc)return;
    doc.dirty=dirty;
    document.querySelectorAll(".editor-tab").forEach(tab=>{
      if(tab.dataset.docId===id)tab.querySelector(".tab-label").textContent=doc.name+(dirty?" ●":"");
    });
  }
  setDocumentPath(id,filePath) {
    const doc=this.documents.get(id);if(!doc)return;
    doc.path=filePath;doc.dirty=false;
    document.querySelectorAll(".editor-tab").forEach(tab=>{
      if(tab.dataset.docId===id)tab.querySelector(".tab-label").textContent=doc.name;
    });
  }
  activateDocument(id) {
    if(!this.documents.has(id))return;
    this.activeDocumentId=id;
    this.renderActiveDocument();
    document.querySelectorAll(".editor-tab").forEach(tab=>tab.classList.toggle("active",tab.dataset.docId===id));
    this.render();
  }
  bindEditorTab(tab) {
    tab.addEventListener("click",e=>{
      if(e.target.closest(".tab-close"))return;
      if(tab.dataset.docId)this.activateDocument(tab.dataset.docId);
    });
    tab.addEventListener("keydown",e=>{
      if((e.key==="Enter"||e.key===" ")&&!e.target.closest(".tab-close")) {
        e.preventDefault();
        if(tab.dataset.docId)this.activateDocument(tab.dataset.docId);
      }
    });
    tab.addEventListener("dragstart",e=>{this.drag={panel:"editor",source:"editor-main"};e.dataTransfer.setData("text/plain","editor");});
    tab.addEventListener("dragend",()=>{this.drag=null;});
    tab.querySelector(".tab-close")?.addEventListener("click",async e=>{
      e.stopPropagation();
      const id=tab.dataset.docId,doc=this.documents.get(id);
      if(doc?.dirty) {
        const accepted=await new Promise(resolve=>
          window.dispatchEvent(new CustomEvent("miasquid:confirm-close",{detail:{name:doc.name,resolve}})));
        if(!accepted)return;
      }
      if(id)this.documents.delete(id);
      const wasActive=tab.classList.contains("active");
      const tabId=tab.dataset.tabId;
      document.querySelectorAll(".editor-tab").forEach(item=>{
        if(id ? item.dataset.docId===id : item.dataset.tabId===tabId)item.remove();
      });
      if(wasActive||this.activeDocumentId===id) {
        const next=document.querySelector(".editor-tab[data-doc-id]");
        if(next)this.activateDocument(next.dataset.docId);
        else {
          this.activeDocumentId=null;
          const editor=document.querySelector(".editor-content");
          if(editor)editor.innerHTML='<div class="welcome-view"><div class="welcome-logo">🦑</div><h1>Welcome to <span>MiaSquid IDE</span></h1><p>Your workspace. Your tools. Your way.</p></div>';
          this.render();
          window.dispatchEvent(new Event("miasquid:active-document"));
        }
      } else {
        this.render();
      }
    });
  }
}

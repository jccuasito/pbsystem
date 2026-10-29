<script setup lang="ts">
import { nextTick,onMounted,onBeforeUnmount,ref } from 'vue'
import { lockBodyScroll } from '../utils/bodyScrollLock'
const props=defineProps<{title:string;subtitle?:string;busy?:boolean}>()
const emit=defineEmits<{close:[]}>()
const overlay=ref<HTMLElement|null>(null),dialog=ref<HTMLElement|null>(null),closeButton=ref<HTMLButtonElement|null>(null)
let release=()=>{},previousFocus:HTMLElement|null=null
const background:Array<{element:HTMLElement;inert:boolean}>=[]
function handleKeydown(event:KeyboardEvent){
 if(event.key==='Escape'){event.preventDefault();close();return}
 if(event.key!=='Tab'||!dialog.value)return
 const nodes=[...dialog.value.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],summary,[tabindex]')].filter(node=>!node.hasAttribute('disabled')&&node.tabIndex>=0&&node.getClientRects().length>0)
 const first=nodes[0],last=nodes[nodes.length-1]
 if(!first){event.preventDefault();dialog.value.focus();return}
 if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}else if(!dialog.value.contains(document.activeElement)){event.preventDefault();first.focus()}
}
function close(){if(!props.busy)emit('close')}
// Keep the chat in the portal's DOM tree: mobile previews capture this subtree.
// Inert sibling branches instead of the chat's ancestors, including nested profiles.
onMounted(async()=>{
 previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null
 release=lockBodyScroll()
 let branch:HTMLElement|null=overlay.value
 while(branch&&branch!==document.body){
  const parent=branch.parentElement
  if(!parent)break
  for(const sibling of parent.children)if(sibling!==branch&&sibling instanceof HTMLElement&&!['SCRIPT','STYLE','LINK'].includes(sibling.tagName)){background.push({element:sibling,inert:sibling.inert});sibling.inert=true}
  branch=parent
 }
 await nextTick();closeButton.value?.focus({preventScroll:true})
})
onBeforeUnmount(()=>{for(const {element,inert} of background)element.inert=inert;release();if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true})})
</script>
<template><div ref="overlay" class="request-chat-overlay" @click.self="close"><section ref="dialog" class="request-chat-window" role="dialog" aria-label="Request messages" aria-modal="true" tabindex="-1" @keydown.stop="handleKeydown"><header class="chat-window-heading"><span class="chat-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1-2 2Z"/><path d="M7 8h10M7 12h7"/></svg></span><div><strong>{{title}}</strong><small v-if="subtitle">{{subtitle}}</small></div><button ref="closeButton" type="button" class="chat-close" aria-label="Close conversation" :disabled="busy" @click="close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><div class="chat-window-body"><slot/></div></section></div></template>
<style scoped>
.request-chat-overlay{position:fixed;inset:0;z-index:12000;display:flex;align-items:flex-end;justify-content:flex-end;padding:20px 24px;box-sizing:border-box;background:#152d4b26}.request-chat-window{box-sizing:border-box;display:flex;flex-direction:column;position:relative;margin:0;padding:0;width:460px;max-width:100%;height:min(710px,calc(100dvh - 40px));max-height:100%;border:1px solid #cfdbec;border-radius:13px;box-shadow:0 18px 65px #112b4a35;color:#20395e;background:#fff;font-family:'DM Sans',Inter,'Segoe UI',sans-serif;font-size:16px;line-height:1.5;overflow:hidden}.request-chat-window :deep(*){box-sizing:border-box}.chat-window-heading{display:flex;align-items:center;gap:11px;padding:15px 18px;background:#193f71;color:#fff;flex-shrink:0}.chat-symbol{width:31px;height:31px;background:#ffffff12;border-radius:7px;display:grid;place-items:center;flex-shrink:0}.chat-symbol svg{width:18px;height:18px}.chat-window-heading>div{min-width:0;flex:1}.chat-window-heading strong{display:block;font-size:.82rem;line-height:1.5;overflow-wrap:anywhere}.chat-window-heading small{display:block;font-size:.65rem;color:#bdd1ea;line-height:1.6;overflow-wrap:anywhere}.chat-close{display:grid;place-items:center;width:32px;height:32px;min-height:32px;flex-shrink:0;border:0;border-radius:5px;color:#d1dff0;background:transparent;cursor:pointer;padding:6px}.chat-close:hover{background:#ffffff18}.chat-close:disabled{opacity:.4;cursor:default}.chat-close svg{width:18px;height:18px}.chat-close:focus-visible{outline:2px solid #a5ceff;outline-offset:1px}.chat-window-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column}.chat-window-body :deep(.request-thread){flex:1;min-height:0}
@media(max-width:600px){.request-chat-overlay{padding:10px}.request-chat-window{width:100%;height:min(680px,calc(100dvh - 20px));border-radius:11px}.chat-window-heading{padding:13px 15px}.chat-window-heading strong{font-size:.78rem}}
</style>

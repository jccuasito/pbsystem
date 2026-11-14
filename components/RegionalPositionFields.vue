<script setup lang="ts">
import { useId } from 'vue'
import { rateFormFields } from '~~/shared/utils/rateFields'
const props=defineProps<{modelValue:Record<string,any>;overrides:Record<string,number>;regional:Record<string,any>}>()
const emit=defineEmits<{'update:modelValue':[value:Record<string,any>];'update:overrides':[value:Record<string,number>]}>()
const prefix=useId()
const custom=(key:string)=>Object.hasOwn(props.overrides,key)
function toggle(key:string,enabled:boolean){const next={...props.overrides};if(enabled)next[key]=Number(props.modelValue[key]||0);else delete next[key];emit('update:overrides',next);emit('update:modelValue',{...props.modelValue,[key]:enabled?props.modelValue[key]:props.regional[key]??0})}
function change(key:string,value:string){emit('update:overrides',{...props.overrides,[key]:Number(value)});emit('update:modelValue',{...props.modelValue,[key]:value})}
</script>
<template>
 <div class="position-fields">
  <section v-for="field in rateFormFields" :key="field.key" class="amount-card" :class="{'amount-card--custom':custom(field.key)}">
   <label :for="prefix+field.key">{{field.label}}</label>
   <input :id="prefix+field.key" :value="modelValue[field.key]" :disabled="!custom(field.key)" type="number" min="0" max="99999999.99" step="0.01" @input="change(field.key,($event.target as HTMLInputElement).value)">
   <label class="custom-toggle"><input type="checkbox" :checked="custom(field.key)" :aria-label="'Custom amount for '+field.label" @change="toggle(field.key,($event.target as HTMLInputElement).checked)"><span>Custom amount</span></label>
   <small>{{custom(field.key)?'Specific to this position.':'Follows the regional rate and its effective updates.'}}</small>
  </section>
 </div>
</template>
<style scoped>
.position-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.amount-card{min-width:0;padding:15px 16px;border:1px solid var(--theme-line,#dae5f5);border-radius:11px;background:var(--theme-soft,#f9fbfe);display:grid;align-content:start;gap:8px}.amount-card--custom{border-color:#a8c0f0;background:var(--theme-soft,#f4f8ff)}.amount-card>label{color:var(--theme-muted,#425875);font-size:.82rem;font-weight:650}.amount-card>input{box-sizing:border-box;min-width:0;width:100%;min-height:44px;padding:9px 11px;border:1px solid var(--theme-line,#cbd9ef);border-radius:8px;font:inherit;font-size:.94rem;color:var(--theme-ink,#203b60);background:var(--theme-surface,#fff);font-variant-numeric:tabular-nums}.amount-card>input:disabled{background:var(--theme-soft,#ecf2fb);color:var(--theme-accent,#587dab);opacity:1;-webkit-text-fill-color:#587dab}.amount-card>input:focus{outline:3px solid var(--theme-line,#e0eaff);border-color:#749bea}.amount-card .custom-toggle{display:flex;align-items:center;gap:8px;margin-top:2px;cursor:pointer;font-size:.76rem;font-weight:600}.custom-toggle input{appearance:auto;width:15px;height:15px;min-height:0;margin:0;accent-color:#2563eb;flex:none}.amount-card small{font-size:.7rem;line-height:1.5;color:var(--theme-muted,#7a8ca7);font-weight:400}@media(max-width:750px){.position-fields{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:420px){.position-fields{grid-template-columns:1fr}}
</style>

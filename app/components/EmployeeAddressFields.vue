<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import SearchableSelect from '../../components/SearchableSelect.vue'
import { findAddressOption, loadAddressOptions, type AddressField, type AddressOption, type EmployeeAddress } from '../utils/philippineAddress'
const props = withDefaults(defineProps<{ modelValue: EmployeeAddress; disabled?: boolean }>(), { disabled: false })
const emit = defineEmits<{ 'update:modelValue': [value: EmployeeAddress] }>()
const regions=ref<AddressOption[]>([]), provinces=ref<AddressOption[]>([]), cities=ref<AddressOption[]>([]), barangays=ref<AddressOption[]>([])
const loading=ref(false), error=ref('')
let request=0, mounted=false
const asOptions=(options:AddressOption[],field:AddressField)=>{
  const entries=options.map(option=>({value:option.code,label:option.name}))
  const saved=props.modelValue[field]
  if(saved&&!findAddressOption(options,saved,field)) entries.unshift({value:'saved',label:saved+' (saved value)'})
  return entries
}
function selection(options:AddressOption[],field:AddressField) {
  return findAddressOption(options,props.modelValue[field],field)?.code || (props.modelValue[field]?'saved':'')
}
function patch(field:AddressField,value:string) { emit('update:modelValue',{...props.modelValue,[field]:value}) }
function choose(field:AddressField,code:string|number) {
  if(props.disabled||!code||code==='saved')return
  const options=field==='Region'?regions.value:field==='Province'?provinces.value:field==='CityMunicipality'?cities.value:barangays.value
  const selected=options.find(option=>option.code===String(code))
  if(!selected)return
  const next={...props.modelValue,[field]:selected.code.startsWith('none:')?'':selected.name}
  if(field==='Region')Object.assign(next,{Province:'',CityMunicipality:'',Barangay:'',PostalCode:''})
  else if(field==='Province')Object.assign(next,{CityMunicipality:'',Barangay:'',PostalCode:''})
  else if(field==='CityMunicipality')Object.assign(next,{Barangay:'',PostalCode:''})
  emit('update:modelValue',next)
}
function clearLocation(){if(!props.disabled)emit('update:modelValue',{...props.modelValue,Region:'',Province:'',CityMunicipality:'',Barangay:'',PostalCode:''})}
async function syncOptions(){
  const current=++request
  loading.value=true;error.value=''
  provinces.value=[];cities.value=[];barangays.value=[]
  try{
    const root=await loadAddressOptions('regions')
    if(current!==request)return
    regions.value=root
    const region=findAddressOption(root,props.modelValue.Region,'Region')
    if(!region)return
    const provinceRows=await loadAddressOptions('provinces',region.code)
    if(current!==request)return
    provinces.value=provinceRows
    const province=findAddressOption(provinceRows,props.modelValue.Province,'Province')
    if(!province)return
    const cityRows=await loadAddressOptions('cities',province.code)
    if(current!==request)return
    cities.value=cityRows
    const city=findAddressOption(cityRows,props.modelValue.CityMunicipality,'CityMunicipality')
    if(!city)return
    const barangayRows=await loadAddressOptions('barangays',city.code)
    if(current===request)barangays.value=barangayRows
  }catch{if(current===request)error.value='Address choices could not be loaded. Your saved address has been kept.'}
  finally{if(current===request)loading.value=false}
}
watch(()=>[props.modelValue.Region,props.modelValue.Province,props.modelValue.CityMunicipality],()=>{if(mounted)void syncOptions()})
onMounted(()=>{mounted=true;void syncOptions()})
onBeforeUnmount(()=>{mounted=false;request++})
</script>
<template>
  <div class="address-editor" :aria-busy="loading">
    <p class="address-help">Choose your region, province or no-province group, city/municipality, then barangay.</p>
    <div class="address-grid">
      <SearchableSelect :model-value="selection(regions,'Region')" label="Region" :options="asOptions(regions,'Region')" placeholder="Search or select region" :disabled="disabled||!regions.length" @change="choose('Region',$event)" />
      <SearchableSelect :model-value="selection(provinces,'Province')" label="Province / area" :options="asOptions(provinces,'Province')" placeholder="Choose region first" :disabled="disabled||!provinces.length" @change="choose('Province',$event)" />
      <SearchableSelect :model-value="selection(cities,'CityMunicipality')" label="City / Municipality" :options="asOptions(cities,'CityMunicipality')" placeholder="Choose province or area first" :disabled="disabled||!cities.length" @change="choose('CityMunicipality',$event)" />
      <SearchableSelect :model-value="selection(barangays,'Barangay')" label="Barangay" :options="asOptions(barangays,'Barangay')" placeholder="Choose city / municipality first" :disabled="disabled||!barangays.length" @change="choose('Barangay',$event)" />
      <label>Unit / House number<input :value="modelValue.UnitHouseNumber" :disabled="disabled" autocomplete="off" @input="patch('UnitHouseNumber',($event.target as HTMLInputElement).value)" /></label>
      <label>Street<input :value="modelValue.Street" :disabled="disabled" autocomplete="off" @input="patch('Street',($event.target as HTMLInputElement).value)" /></label>
      <label>Subdivision / Village<input :value="modelValue.Subdivision" :disabled="disabled" autocomplete="off" @input="patch('Subdivision',($event.target as HTMLInputElement).value)" /></label>
      <label>Postal code<input :value="modelValue.PostalCode" :disabled="disabled" inputmode="numeric" autocomplete="postal-code" maxlength="10" placeholder="Enter postal code" @input="patch('PostalCode',($event.target as HTMLInputElement).value)" /></label>
    </div>
    <div class="address-footer"><span v-if="loading" role="status">Loading address choices…</span><span v-else>Existing saved address values stay unchanged until you select a replacement.</span><button v-if="modelValue.Region||modelValue.Province||modelValue.CityMunicipality||modelValue.Barangay" type="button" :disabled="disabled" @click="clearLocation">Clear location</button></div>
    <p v-if="error" class="address-error" role="alert">{{ error }} <button type="button" :disabled="disabled" @click="syncOptions">Try again</button></p>
  </div>
</template>
<style scoped>
.address-editor{display:grid;gap:14px}.address-help,.address-footer,.address-error{margin:0;font-size:.78rem;line-height:1.5;color:#657d9f}.address-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.address-grid>label{display:flex;flex-direction:column;gap:8px;font-size:.85rem;font-weight:700;color:#475569}.address-grid>label>input,.address-grid :deep(.searchable-select>input){box-sizing:border-box;width:100%;height:50px;min-height:50px;padding:12px 14px;border:1px solid #cbd9ee;border-radius:10px;background:#fff;color:#112b53;font:inherit;font-size:.86rem}.address-grid :deep(.searchable-select>label){font-size:.85rem;margin-bottom:8px;line-height:normal}.address-grid :deep(.searchable-select>input){padding-right:36px;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%23526c92' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 12px center}.address-grid :deep(.searchable-select__menu){z-index:30;margin-top:5px;max-height:240px;border-radius:10px}.address-grid input:focus-visible,.address-grid :deep(input:focus-visible){outline:2px solid #2b63e8;outline-offset:2px}.address-grid>label>input:disabled,.address-grid :deep(input:disabled){background-color:#f4f6fa;color:#768399;cursor:not-allowed}.address-footer{display:flex;align-items:center;justify-content:space-between;gap:15px}.address-footer button,.address-error button{flex:none;padding:0;border:0;background:none;color:#245dcd;text-decoration:underline;font:inherit;cursor:pointer}.address-footer button:disabled{opacity:.5;cursor:not-allowed}.address-error{color:#b42318}@media(max-width:650px){.address-grid{grid-template-columns:1fr}.address-footer{align-items:flex-start;flex-direction:column}}
</style>

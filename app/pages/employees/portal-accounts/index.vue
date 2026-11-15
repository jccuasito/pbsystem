<script setup lang="ts">
import EmployeePayslipWorkspace from '../../../components/EmployeePayslipWorkspace.vue'
defineProps<{employee?:any;embedded?:boolean;initialSection?:string;initialSectionRequest?:number}>()
const emit=defineEmits<{close:[]}>()
</script>
<template><EmployeePayslipWorkspace :employee="employee" :embedded="embedded" :initial-section="initialSection" :initial-section-request="initialSectionRequest" mode="accounts" @close="emit('close')"/></template>

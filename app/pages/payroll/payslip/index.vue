<script setup lang="ts">
import EmployeePayslipWorkspace from '../../../components/EmployeePayslipWorkspace.vue'
defineProps<{employee?:any;embedded?:boolean}>()
const emit=defineEmits<{close:[]}>()
</script>
<template><EmployeePayslipWorkspace :employee="employee" :embedded="embedded" mode="payslips" @close="emit('close')"/></template>

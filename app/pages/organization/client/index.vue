<script setup lang="ts">
import OrganizationCrud from '../../../../components/OrganizationCrud.vue'

const fields = [{ key: 'ClientName', label: 'Client name', required: true }, { key: 'RegionID', label: 'Region', type: 'select', optionsKey: 'regions' }, { key: 'ClientAddress', label: 'Address', type: 'textarea' }, { key: 'ContractStart', label: 'Contract start', type: 'date' }, { key: 'ContractEnd', label: 'Contract end', type: 'date' }, { key: 'Status', label: 'Status', type: 'select' }]
const columns = [{ key: 'ClientName', label: 'Client' }, { key: 'RegionName', label: 'Region' }, { key: 'ContractStart', label: 'Start' }, { key: 'ContractEnd', label: 'End' }, { key: 'Status', label: 'Status' }]
</script>
<template><OrganizationCrud resource="client" title="Clients" :fields="fields" :columns="columns" /></template>

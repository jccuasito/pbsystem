<script setup lang="ts">
import OrganizationCrud from '../../../../components/OrganizationCrud.vue'

const fields = [{ key: 'PositionName', label: 'Position name', required: true }, { key: 'Description', label: 'Description', type: 'textarea' }, { key: 'Status', label: 'Status', type: 'select' }]
const columns = [{ key: 'PositionName', label: 'Position' }, { key: 'Description', label: 'Description' }, { key: 'Status', label: 'Status' }]
</script>
<template><OrganizationCrud resource="position" title="Positions" :fields="fields" :columns="columns" /></template>

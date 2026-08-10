<script setup lang="ts">
import OrganizationCrud from '../../../../components/OrganizationCrud.vue'

const fields = [
  { key: 'RegionCode', label: 'Region code', required: true },
  { key: 'RegionName', label: 'Region name', required: true },
  { key: 'Status', label: 'Status', type: 'select' }
]
const columns = [
  { key: 'RegionCode', label: 'Code' },
  { key: 'RegionName', label: 'Region' },
  { key: 'Status', label: 'Status' }
]
</script>
<template><OrganizationCrud resource="region" title="Regions" :fields="fields" :columns="columns" /></template>
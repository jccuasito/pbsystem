<script setup lang="ts">
import OrganizationCrud from '../../../../components/OrganizationCrud.vue'

const fields = [
  { key: 'RegionCode', label: 'PSGC code (2 digits)', required: true },
  { key: 'RegionName', label: 'Region name', required: true },
  { key: 'Status', label: 'Status', type: 'select' }
]
const columns = [
  { key: 'RegionCode', label: 'PSGC code' },
  { key: 'RegionName', label: 'Region' },
  { key: 'Status', label: 'Status' }
]
</script>
<template><OrganizationCrud resource="region" title="Regions" description="Philippine regions used for site and rate assignments. Region names are saved in uppercase." :fields="fields" :columns="columns" /></template>

<script setup lang="ts">
import OrganizationCrud from '../../../../components/OrganizationCrud.vue'

const fields = [{ key: 'ClientID', label: 'Client', type: 'select', optionsKey: 'clients', required: true }, { key: 'RegionID', label: 'Site region', type: 'select', optionsKey: 'regions', required: true }, { key: 'SiteName', label: 'Site name', required: true }, { key: 'SiteAddress', label: 'Address', type: 'textarea' }, { key: 'LogoData', label: 'Site logo', type: 'file' }, { key: 'Status', label: 'Status', type: 'select' }]
const columns = [{ key: 'Logo', label: 'Logo' }, { key: 'SiteName', label: 'Site' }, { key: 'ClientName', label: 'Client' }, { key: 'RegionName', label: 'Region' }, { key: 'SiteAddress', label: 'Address' }, { key: 'PolicySource', label: 'Policy source' }, { key: 'Status', label: 'Status' }]
</script>
<template><OrganizationCrud resource="site" title="Sites" :fields="fields" :columns="columns" /></template>

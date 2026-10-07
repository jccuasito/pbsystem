<script setup lang="ts">
import OrganizationCrud from '../../../../components/OrganizationCrud.vue'

const fields = [{ key: 'ClientID', label: 'Client', type: 'searchable-select', optionsKey: 'clients', required: true }, { key: 'RegionID', label: 'Site region', type: 'select', optionsKey: 'regions', required: true }, { key: 'SiteName', label: 'Site name', required: true }, { key: 'SiteAddress', label: 'Address', type: 'textarea' }, { key: 'AgencyIDs', label: 'Assigned agencies', type: 'multiselect', optionsKey: 'agencies', required: true }, { key: 'LogoData', label: 'Site logo', type: 'file' }, { key: 'Status', label: 'Status', type: 'select' }]
const columns = [{ key: 'Logo', label: 'Logo' }, { key: 'SiteName', label: 'Site' }, { key: 'ClientName', label: 'Client' }, { key: 'AgencyNames', label: 'Agencies' }, { key: 'RegionName', label: 'Region' }, { key: 'SiteAddress', label: 'Address' }, { key: 'Status', label: 'Status' }]
</script>
<template><OrganizationCrud resource="site" title="Sites" description="Manage each site's client, region, and assigned agencies." search-placeholder="Search site, client, agency, or region" :fields="fields" :columns="columns" /></template>

<script setup lang="ts">
import OrganizationCrud from '../../../../components/OrganizationCrud.vue'

const fields = [{ key: 'ClientID', label: 'Client', type: 'searchable-select', optionsKey: 'clients', required: true }, { key: 'RegionID', label: 'Site region', type: 'select', optionsKey: 'regions', required: true }, { key: 'SiteName', label: 'Site name', required: true }, { key: 'SiteAddress', label: 'Address', type: 'textarea' }, { key: 'AgencyID', label: 'Agency', type: 'searchable-select', optionsKey: 'agencies', required: true }, { key: 'SiteAccountID', label: 'Site Account', type: 'searchable-select', optionsKey: 'siteAccounts', required: true }, { key: 'LogoData', label: 'Site logo', type: 'file' }, { key: 'Status', label: 'Status', type: 'select' }]
const columns = [{ key: 'Logo', label: 'Logo' }, { key: 'SiteName', label: 'Site' }, { key: 'ClientName', label: 'Client' }, { key: 'AgencyNames', label: 'Agency' }, { key: 'SiteAccountName', label: 'Site Account' }, { key: 'RegionName', label: 'Region' }, { key: 'SiteAddress', label: 'Address' }, { key: 'Status', label: 'Status' }]
</script>
<template><OrganizationCrud resource="site" title="Sites" description="Each site record belongs to one agency, with its own account, details and status." search-placeholder="Search site, account, client, agency, or region" :fields="fields" :columns="columns" /></template>

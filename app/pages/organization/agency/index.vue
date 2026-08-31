<script setup lang="ts">
import OrganizationCrud from '../../../../components/OrganizationCrud.vue'

const fields = [{ key: 'AgencyName', label: 'Agency name', required: true }, { key: 'AgencyAddress', label: 'Address', type: 'textarea' }, { key: 'AgencyEmail', label: 'Email', type: 'email' }, { key: 'AgencyContact', label: 'Contact number' }, { key: 'LogoData', label: 'Agency logo', type: 'file' }, { key: 'Status', label: 'Status', type: 'select' }]
const columns = [{ key: 'Logo', label: 'Logo' }, { key: 'AgencyName', label: 'Agency' }, { key: 'AgencyAddress', label: 'Address' }, { key: 'AgencyEmail', label: 'Email' }, { key: 'AgencyContact', label: 'Contact' }, { key: 'Status', label: 'Status' }]
</script>
<template><OrganizationCrud resource="agency" title="Agencies" :fields="fields" :columns="columns" /></template>

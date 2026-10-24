<script setup lang="ts">
import OrganizationCrud from '../../../../components/OrganizationCrud.vue'
const fields=[{key:'SiteAccountName',label:'Site Account name',required:true},{key:'Status',label:'Status',type:'select'}]
const columns=[{key:'SiteAccountName',label:'Site Account'},{key:'SiteCount',label:'Linked sites'},{key:'Status',label:'Status'}]
</script>
<template>
  <OrganizationCrud resource="site-account" title="Site Accounts" description="Create account names here, then assign each site through Organization > Site. Accounts are independent of agencies." search-placeholder="Search Site Account name" :fields="fields" :columns="columns" />
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { Device, type DeviceInfo } from "@wefter/plugin-device-info";

const deviceInfo = ref<DeviceInfo | null>(null);
const deviceError = ref<string | null>(null);

onMounted(async () => {
  try {
    deviceInfo.value = await Device.getInfo();
  } catch (err) {
    deviceError.value = err instanceof Error ? err.message : String(err);
  }
});

const test = () => {
  alert("Hakuna Matata"); // Won't Run in mobile
};
</script>

<template>
  <h1>Wefter Demo (Vue + TS)</h1>
  <section>
    <h2>Device Info</h2>
    <pre v-if="deviceInfo">{{ deviceInfo }}</pre>
    <pre v-else-if="deviceError">ERROR: {{ deviceError }}</pre>
    <pre v-else>loading...</pre>
  </section>
  <section>
    <h2>Testing</h2>
    <ul></ul>
    <button @click="test">Test</button>
  </section>
</template>

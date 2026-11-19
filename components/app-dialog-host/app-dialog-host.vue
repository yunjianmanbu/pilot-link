<template>
  <app-dialog
    :visible="state.visible"
    :title="state.title"
    :message="state.message"
    :icon="state.icon"
    :cancel-text="state.cancelText"
    :confirm-text="state.confirmText"
    :danger="state.danger"
    @confirm="resolve(true)"
    @cancel="resolve(false)"
    @close="resolve(false)"
  />
</template>

<script>
import AppDialog from '../app-dialog/app-dialog.vue'
import { closeAppDialog, subscribeAppDialog } from '../../lib/dialog.js'

export default {
  name: 'AppDialogHost',
  components: { AppDialog },
  data() {
    return {
      state: {
        visible: false,
        title: '',
        message: '',
        icon: '',
        cancelText: '',
        confirmText: '',
        danger: false
      }
    }
  },
  created() {
    this.unsubscribe = subscribeAppDialog((state) => {
      this.state = state
    })
  },
  beforeUnmount() {
    if (typeof this.unsubscribe === 'function') this.unsubscribe()
    this.unsubscribe = null
  },
  methods: {
    resolve(confirmed) {
      closeAppDialog(confirmed)
    }
  }
}
</script>

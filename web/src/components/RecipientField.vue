<template>
  <div class="field recipient-field" :class="{ 'field--wide': wide }">
    <label class="field__label" :for="id">{{ label }}</label>
    <input
      :id="id"
      v-model="model"
      :required="required"
      :disabled="disabled"
      :aria-expanded="showSuggestions"
      :aria-controls="`${id}-suggestions`"
      :aria-activedescendant="showSuggestions && active >= 0 ? `${id}-option-${active}` : undefined"
      aria-autocomplete="list"
      role="combobox"
      autocomplete="off"
      @focus="open = true"
      @blur="open = false"
      @input="active = -1; open = true"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.enter="chooseActive"
      @keydown.esc="open = false"
    />
    <div v-show="showSuggestions" :id="`${id}-suggestions`" class="recipient-suggestions" role="listbox" :aria-label="`${label}联系人建议`">
      <LineOutline />
      <div
        v-for="(contact, index) in suggestions"
        :id="`${id}-option-${index}`"
        :key="contact.email"
        class="recipient-suggestions__item"
        :class="{ 'is-active': index === active }"
        role="option"
        :aria-selected="index === active"
        @pointerdown.prevent="select(contact.email)"
      >
        <strong>{{ contact.name || contact.email }}</strong>
        <span v-if="contact.name">{{ contact.email }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import LineOutline from './LineOutline.vue';
import { completeRecipientToken } from "../mail/recipients";

const props = withDefaults(defineProps<{
  id: string;
  label: string;
  contacts: { name: string; email: string }[];
  required?: boolean;
  wide?: boolean;
  disabled?: boolean;
}>(), { required: false, wide: false, disabled: false });

const model = defineModel<string>({ required: true });
const open = ref(false);
const active = ref(-1);
const token = computed(() => model.value.split(",").at(-1)?.trim().toLowerCase() ?? "");
const suggestions = computed(() => props.contacts.filter((contact) => {
  const needle = token.value;
  return needle.length > 0 && `${contact.name} ${contact.email}`.toLowerCase().includes(needle);
}).slice(0, 5));
const showSuggestions = computed(() => !props.disabled && open.value && suggestions.value.length > 0);

function move(direction: number): void {
  if (!showSuggestions.value) return;
  active.value = (active.value + direction + suggestions.value.length) % suggestions.value.length;
}

function select(email: string): void {
  if (props.disabled) return;
  model.value = completeRecipientToken(model.value, email);
  open.value = false;
  active.value = -1;
}

function chooseActive(event: KeyboardEvent): void {
  if (!showSuggestions.value || active.value < 0) return;
  const contact = suggestions.value[active.value];
  if (!contact) return;
  event.preventDefault();
  select(contact.email);
}
</script>

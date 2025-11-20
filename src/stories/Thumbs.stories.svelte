<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Thumbs from '$lib/components/Thumbs.svelte';
  const { Story } = defineMeta({ title: 'Calliope/Thumbs', component: Thumbs, tags: ['autodocs'] });
</script>

<Story name="Default Thumbs" />

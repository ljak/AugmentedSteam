<script lang="ts">
    import { __hoursShort } from "@Strings/_strings";
    import { L } from "@Core/Localization/Localization";

    export let hltbMainStoryTime: number | null;

    function hrs(minutes: number): string {
        if (minutes <= 0) return "-";
        return L(__hoursShort, { "hours": (minutes / 60).toFixed(1).toString() });
    }
</script>

{#if hltbMainStoryTime && hltbMainStoryTime > 0}
    <div class="wishlist_hltb_time">
        <span>{hrs(hltbMainStoryTime)}</span>
    </div>
{:else}
    <div class="wishlist_hltb_time">
        <span>-</span>
    </div>
{/if}

<style>
    .wishlist_hltb_time {
        font-size: 0.9em;
        color: #8f98a0; /* Subtle color from Steam's palette */
        margin-top: 2px;
    }
</style>

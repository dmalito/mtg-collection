<script>
  export let card;
  export let onToggleOwned;
  export let compact = false;

  // Double-faced cards keep their images on the faces, not the card
  $: images = card.image_uris || card.card_faces?.[0]?.image_uris;
  $: imageUrl = images?.normal || images?.small || '';
  $: isOwned = card.owned > 0;

  function handleClick() {
    onToggleOwned(card);
  }
</script>

<div class="card" class:owned={isOwned} class:compact on:click={handleClick}>
  {#if imageUrl}
    <img src={imageUrl} alt={card.name} />
  {:else}
    <div class="placeholder">
      <p>{card.name}</p>
    </div>
  {/if}
  
  <div class="overlay">
    <div class="owned-badge" class:visible={isOwned}>
      ✓ {card.owned}
    </div>
  </div>

  {#if card.upcoming}
    <div class="upcoming-badge" title="Releases {card.released_at}">Upcoming</div>
  {/if}

  {#if !compact}
    <div class="card-info">
      <div class="name">{card.name}</div>
      <div class="details">
        {card.set.toUpperCase()} #{card.collector_number}
      </div>
    </div>
  {/if}
</div>

<style>
  .card {
    position: relative;
    border-radius: 12px;
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
    background: #1a1a1a;
    border: 2px solid transparent;
  }

  .card:hover {
    transform: translateY(-5px);
    box-shadow: 0 8px 20px rgba(0,0,0,0.3);
  }

  .card.owned {
    border-color: #4caf50;
  }

  .card.compact {
    border-radius: 8px;
  }

  .card.compact:hover {
    transform: translateY(-3px);
  }

  .card img {
    width: 100%;
    height: auto;
    display: block;
  }

  .placeholder {
    aspect-ratio: 5/7;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #2a2a2a;
    padding: 20px;
    text-align: center;
    color: #999;
  }

  .overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(to bottom, transparent 60%, rgba(0,0,0,0.8));
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
  }

  .card:hover .overlay {
    opacity: 1;
  }

  .owned-badge {
    position: absolute;
    top: 10px;
    right: 10px;
    background: #4caf50;
    color: white;
    padding: 6px 12px;
    border-radius: 20px;
    font-weight: bold;
    font-size: 0.9em;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .owned-badge.visible {
    opacity: 1;
  }

  .upcoming-badge {
    position: absolute;
    top: 10px;
    left: 10px;
    background: #f0a020;
    color: #000;
    padding: 4px 10px;
    border-radius: 20px;
    font-weight: bold;
    font-size: 0.75em;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .card.compact .upcoming-badge {
    top: 5px;
    left: 5px;
    padding: 2px 6px;
    font-size: 0.65em;
  }

  .card.compact .owned-badge {
    top: 5px;
    right: 5px;
    padding: 4px 8px;
    font-size: 0.8em;
  }

  .card-info {
    padding: 12px;
    background: #1a1a1a;
  }

  .name {
    font-weight: 600;
    margin-bottom: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .details {
    font-size: 0.85em;
    color: #999;
  }
</style>
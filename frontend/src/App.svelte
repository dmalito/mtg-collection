<script>
  import { onMount } from 'svelte';
  import { api } from './lib/api.js';
  import Card from './components/Card.svelte';

  let types = [];
  let selectedType = 'dinosaur';
  let selectedRarity = null;
  let cards = [];
  let filteredCards = [];
  let loading = false;
  let error = null;
  let columns = 4;
  let viewMode = 'comfortable';
  
  // New filters
  let searchQuery = '';
  let ownershipFilter = 'all'; // 'all', 'owned', 'missing'
  let sortBy = 'release'; // 'release', 'price', 'artist', 'name'
  let sortDirection = 'desc'; // 'asc' or 'desc'
  let includeTokens = false; // New: toggle for tokens

  const rarities = ['common', 'uncommon', 'rare', 'mythic'];
  const columnOptions = [2, 3, 4, 5, 6];

  onMount(async () => {
    await loadTypes();
    await loadCards();
    const savedColumns = localStorage.getItem('mtg-columns');
    const savedViewMode = localStorage.getItem('mtg-viewMode');
    const savedIncludeTokens = localStorage.getItem('mtg-includeTokens');
    if (savedColumns) columns = parseInt(savedColumns);
    if (savedViewMode) viewMode = savedViewMode;
    if (savedIncludeTokens) includeTokens = savedIncludeTokens === 'true';
  });

  async function loadTypes() {
    try {
      types = await api.getTypes();
      if (types.length > 0 && !selectedType) {
        selectedType = types[0].name;
      }
    } catch (e) {
      console.error('Failed to load types:', e);
    }
  }

  async function loadCards() {
    loading = true;
    error = null;
    try {
      const result = await api.searchCards(selectedType, selectedRarity, includeTokens);
      cards = result.cards || [];
      applyFilters();
    } catch (e) {
      error = 'Failed to load cards. Make sure the backend is running.';
      console.error('Failed to load cards:', e);
      cards = [];
      filteredCards = [];
    } finally {
      loading = false;
    }
  }

  async function toggleOwned(card) {
    try {
      if (card.owned > 0) {
        await api.removeFromCollection(card.id);
        card.owned = 0;
      } else {
        await api.addToCollection(card.id, 1);
        card.owned = 1;
      }
      cards = cards;
      applyFilters();
    } catch (e) {
      console.error('Failed to toggle owned:', e);
      alert('Failed to update collection');
    }
  }

  function selectRarity(rarity) {
    selectedRarity = selectedRarity === rarity ? null : rarity;
    loadCards();
  }

  function selectType(type) {
    selectedType = type;
    selectedRarity = null;
    loadCards();
  }

  function setColumns(num) {
    columns = num;
    localStorage.setItem('mtg-columns', num);
  }

  function setViewMode(mode) {
    viewMode = mode;
    localStorage.setItem('mtg-viewMode', mode);
  }

  function toggleSortDirection() {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    applyFilters();
  }

  function toggleTokens() {
    includeTokens = !includeTokens;
    localStorage.setItem('mtg-includeTokens', includeTokens);
    loadCards();
  }

  function applyFilters() {
    let result = [...cards];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(card => 
        card.name.toLowerCase().includes(query) ||
        card.artist?.toLowerCase().includes(query) ||
        card.set.toLowerCase().includes(query)
      );
    }

    // Ownership filter
    if (ownershipFilter === 'owned') {
      result = result.filter(card => card.owned > 0);
    } else if (ownershipFilter === 'missing') {
      result = result.filter(card => card.owned === 0);
    }

    // Helper function to parse collector number (handles numbers with letters like "123a")
    function parseCollectorNumber(numStr) {
      if (!numStr) return 0;
      const match = numStr.match(/^(\d+)/);
      return match ? parseInt(match[1]) : 0;
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      
      switch(sortBy) {
        case 'release':
          // Primary: release date
          const dateA = new Date(a.released_at);
          const dateB = new Date(b.released_at);
          comparison = dateB - dateA;
          
          // Secondary: if same date, sort by collector number
          if (comparison === 0) {
            const numA = parseCollectorNumber(a.collector_number);
            const numB = parseCollectorNumber(b.collector_number);
            comparison = numB - numA;
          }
          break;
          
        case 'price':
          const priceA = parseFloat(a.prices?.usd || 0);
          const priceB = parseFloat(b.prices?.usd || 0);
          comparison = priceB - priceA;
          
          // Secondary: if same price, sort by name
          if (comparison === 0) {
            comparison = a.name.localeCompare(b.name);
          }
          break;
          
        case 'artist':
          comparison = (a.artist || '').localeCompare(b.artist || '');
          
          // Secondary: if same artist, sort by name
          if (comparison === 0) {
            comparison = a.name.localeCompare(b.name);
          }
          break;
          
        case 'name':
          comparison = a.name.localeCompare(b.name);
          
          // Secondary: if same name, sort by set then collector number
          if (comparison === 0) {
            comparison = a.set.localeCompare(b.set);
            if (comparison === 0) {
              const numA = parseCollectorNumber(a.collector_number);
              const numB = parseCollectorNumber(b.collector_number);
              comparison = numA - numB;
            }
          }
          break;
      }

      // Apply direction
      return sortDirection === 'asc' ? -comparison : comparison;
    });

    filteredCards = result;
  }

  // Reactive: reapply filters whenever dependencies change
  $: {
    searchQuery;
    ownershipFilter;
    sortBy;
    sortDirection;
    if (cards.length > 0) {
      applyFilters();
    }
  }

  $: gridStyle = `grid-template-columns: repeat(${columns}, 1fr);`;
  $: ownedCount = cards.filter(c => c.owned > 0).length;
  $: tokenCount = cards.filter(c => c.type_line?.toLowerCase().includes('token')).length;
</script>

<main>
  <header>
    <div class="header-top">
      <h1>🃏 MTG Dinosaur Collection</h1>
      <a href="/dashboard" class="back-link">← Back to Dashboard</a>
    </div>

    <!-- Search Bar -->
    <div class="search-bar">
      <input 
        type="text" 
        placeholder="Search by name, artist, or set..." 
        bind:value={searchQuery}
        class="search-input"
      />
      {#if searchQuery}
        <button class="clear-search" on:click={() => searchQuery = ''}>✕</button>
      {/if}
    </div>

    <!-- Filters Bar -->
    <div class="filters-bar">
      <!-- Creature Types -->
      <div class="filter-group">
        <label>Type:</label>
        <div class="button-group">
          {#each types as type}
            <button 
              class="filter-btn"
              class:active={selectedType === type.name}
              on:click={() => selectType(type.name)}
            >
              {type.name}
            </button>
          {/each}
        </div>
      </div>

      <!-- Rarity Filter -->
      <div class="filter-group">
        <label>Rarity:</label>
        <div class="button-group">
          <button
            class="filter-btn"
            class:active={selectedRarity === null}
            on:click={() => selectRarity(null)}
          >
            All
          </button>
          {#each rarities as rarity}
            <button
              class="filter-btn rarity-{rarity}"
              class:active={selectedRarity === rarity}
              on:click={() => selectRarity(rarity)}
            >
              {rarity}
            </button>
          {/each}
        </div>
      </div>

      <!-- Ownership Filter -->
      <div class="filter-group">
        <label>Show:</label>
        <div class="button-group">
          <button
            class="filter-btn"
            class:active={ownershipFilter === 'all'}
            on:click={() => ownershipFilter = 'all'}
          >
            All
          </button>
          <button
            class="filter-btn"
            class:active={ownershipFilter === 'owned'}
            on:click={() => ownershipFilter = 'owned'}
          >
            Owned
          </button>
          <button
            class="filter-btn"
            class:active={ownershipFilter === 'missing'}
            on:click={() => ownershipFilter = 'missing'}
          >
            Missing
          </button>
        </div>
      </div>

      <!-- Tokens Toggle -->
      <div class="filter-group">
        <label>
          <input 
            type="checkbox" 
            bind:checked={includeTokens}
            on:change={toggleTokens}
            class="token-checkbox"
          />
          Include Tokens
          {#if tokenCount > 0}
            <span class="token-count">({tokenCount})</span>
          {/if}
        </label>
      </div>

      <!-- Sort with Direction Toggle -->
      <div class="filter-group">
        <label>Sort:</label>
        <div class="button-group">
          <select bind:value={sortBy} class="sort-select">
            <option value="release">Release Date</option>
            <option value="price">Price</option>
            <option value="artist">Artist</option>
            <option value="name">Name</option>
          </select>
          <button 
            class="filter-btn icon-btn sort-direction"
            on:click={toggleSortDirection}
            title="{sortDirection === 'desc' ? 'Descending' : 'Ascending'}"
          >
            {#if sortDirection === 'desc'}
              ↓
            {:else}
              ↑
            {/if}
          </button>
        </div>
      </div>

      <!-- Layout Controls -->
      <div class="filter-group">
        <label>Layout:</label>
        <div class="button-group">
          <select bind:value={columns} on:change={() => setColumns(columns)} class="column-select">
            {#each columnOptions as num}
              <option value={num}>{num} cols</option>
            {/each}
          </select>

          <button
            class="filter-btn icon-btn"
            class:active={viewMode === 'compact'}
            on:click={() => setViewMode('compact')}
            title="Compact view"
          >
            ▦
          </button>
          <button
            class="filter-btn icon-btn"
            class:active={viewMode === 'comfortable'}
            on:click={() => setViewMode('comfortable')}
            title="Comfortable view"
          >
            ▢
          </button>
        </div>
      </div>
    </div>
  </header>

  <section class="main-content">
    {#if loading}
      <div class="loading">
        <div class="spinner"></div>
        Loading cards...
      </div>
    {:else if error}
      <div class="error">{error}</div>
    {:else if filteredCards.length === 0}
      <div class="empty">
        <div class="empty-icon">🃏</div>
        {#if searchQuery || ownershipFilter !== 'all'}
          <p>No cards match your filters</p>
          <button class="filter-btn" on:click={() => { searchQuery = ''; ownershipFilter = 'all'; }}>
            Clear Filters
          </button>
        {:else}
          <p>No cards found</p>
        {/if}
      </div>
    {:else}
      <div class="cards-grid {viewMode}" style={gridStyle}>
        {#each filteredCards as card (card.id)}
          <Card {card} onToggleOwned={toggleOwned} compact={viewMode === 'compact'} />
        {/each}
      </div>
      <div class="results-info">
        <span class="results-count">
          Showing {filteredCards.length} of {cards.length} cards
        </span>
        <span class="owned-count">
          {ownedCount} owned ({cards.length > 0 ? Math.round((ownedCount / cards.length) * 100) : 0}%)
        </span>
      </div>
    {/if}
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0a0a0a;
    color: #ffffff;
  }

  main {
    max-width: 1800px;
    margin: 0 auto;
    padding: 20px;
  }

  header {
    margin-bottom: 30px;
  }

  .header-top {
    margin-bottom: 20px;
  }

  h1 {
    margin: 0 0 10px 0;
    color: #fff;
  }

  .back-link {
    color: #999;
    text-decoration: none;
    font-size: 0.9em;
  }

  .back-link:hover {
    color: #fff;
  }

  .search-bar {
    position: relative;
    margin-bottom: 15px;
  }

  .search-input {
    width: 100%;
    padding: 15px 45px 15px 20px;
    background: #1a1a1a;
    border: 2px solid #2a2a2a;
    border-radius: 12px;
    color: #fff;
    font-size: 1em;
    transition: border-color 0.2s;
  }

  .search-input:focus {
    outline: none;
    border-color: #667eea;
  }

  .search-input::placeholder {
    color: #666;
  }

  .clear-search {
    position: absolute;
    right: 15px;
    top: 50%;
    transform: translateY(-50%);
    background: #2a2a2a;
    border: none;
    color: #999;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    cursor: pointer;
    font-size: 1em;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .clear-search:hover {
    background: #3a3a3a;
    color: #fff;
  }

  .filters-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    padding: 20px;
    background: #1a1a1a;
    border-radius: 12px;
    align-items: center;
  }

  .filter-group {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .filter-group label {
    font-size: 0.9em;
    color: #999;
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 600;
    min-width: 50px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .token-checkbox {
    width: 18px;
    height: 18px;
    cursor: pointer;
    accent-color: #667eea;
  }

  .token-count {
    color: #667eea;
    font-weight: normal;
  }

  .button-group {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .filter-btn {
    padding: 8px 16px;
    background: #2a2a2a;
    border: 2px solid #2a2a2a;
    border-radius: 8px;
    color: #fff;
    cursor: pointer;
    transition: all 0.2s;
    text-transform: capitalize;
    font-size: 0.9em;
    white-space: nowrap;
  }

  .filter-btn:hover {
    background: #3a3a3a;
    border-color: #3a3a3a;
  }

  .filter-btn.active {
    background: #667eea;
    border-color: #667eea;
  }

  .filter-btn.icon-btn {
    padding: 8px 12px;
    font-size: 1.2em;
  }

  .filter-btn.sort-direction {
    font-size: 1.4em;
    padding: 6px 12px;
    line-height: 1;
  }

  .filter-btn.rarity-common.active {
    background: #1a1a1a;
    border-color: #999;
  }

  .filter-btn.rarity-uncommon.active {
    background: #c0c0c0;
    border-color: #c0c0c0;
    color: #000;
  }

  .filter-btn.rarity-rare.active {
    background: #ffd700;
    border-color: #ffd700;
    color: #000;
  }

  .filter-btn.rarity-mythic.active {
    background: #ff4500;
    border-color: #ff4500;
  }

  .column-select, .sort-select {
    padding: 8px 12px;
    background: #2a2a2a;
    border: 2px solid #2a2a2a;
    border-radius: 8px;
    color: #fff;
    cursor: pointer;
    font-size: 0.9em;
  }

  .column-select:hover, .sort-select:hover {
    background: #3a3a3a;
  }

  .main-content {
    min-height: 400px;
  }

  .cards-grid {
    display: grid;
    gap: 20px;
    margin-bottom: 20px;
  }

  .cards-grid.compact {
    gap: 15px;
  }

  .loading {
    text-align: center;
    padding: 60px 20px;
    font-size: 1.2em;
    color: #999;
  }

  .spinner {
    width: 40px;
    height: 40px;
    margin: 0 auto 20px;
    border: 4px solid #2a2a2a;
    border-top-color: #667eea;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error {
    text-align: center;
    padding: 60px 20px;
    font-size: 1.2em;
    color: #ff4757;
  }

  .empty {
    text-align: center;
    padding: 60px 20px;
    color: #999;
  }

  .empty-icon {
    font-size: 4em;
    margin-bottom: 20px;
  }

  .empty p {
    margin-bottom: 20px;
  }

  .results-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    color: #999;
    font-size: 0.9em;
  }

  .owned-count {
    color: #4caf50;
    font-weight: 600;
  }

  @media (max-width: 1024px) {
    .filters-bar {
      flex-direction: column;
      align-items: stretch;
    }

    .filter-group {
      flex-direction: column;
      align-items: stretch;
    }

    .filter-group label {
      min-width: auto;
    }
  }

  @media (max-width: 768px) {
    .cards-grid {
      grid-template-columns: repeat(2, 1fr) !important;
    }
  }
</style>
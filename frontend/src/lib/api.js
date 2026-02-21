const API_BASE = '/api';

export const api = {
  // Cards
  async searchCards(type, rarity = null, includeTokens = false) {
    let url = `${API_BASE}/cards/search?type=${type}`;
    if (rarity) {
      url += `&rarity=${rarity}`;
    }
    if (includeTokens) {
      url += `&includeTokens=true`;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch cards');
    return res.json();
  },

  async getCard(scryfallId) {
    const res = await fetch(`${API_BASE}/cards/${scryfallId}`);
    if (!res.ok) throw new Error('Failed to fetch card');
    return res.json();
  },

  // Collection
  async getCollection() {
    const res = await fetch(`${API_BASE}/collection`);
    if (!res.ok) throw new Error('Failed to fetch collection');
    return res.json();
  },

  async addToCollection(scryfallId, quantity = 1, condition = 'NM') {
    const res = await fetch(`${API_BASE}/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scryfallId, quantity, condition })
    });
    if (!res.ok) throw new Error('Failed to add card');
    return res.json();
  },

  async updateCard(scryfallId, updates) {
    const res = await fetch(`${API_BASE}/collection/${scryfallId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!res.ok) throw new Error('Failed to update card');
    return res.json();
  },

  async removeFromCollection(scryfallId) {
    const res = await fetch(`${API_BASE}/collection/${scryfallId}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Failed to remove card');
    return res.json();
  },

  // Types
  async getTypes() {
    const res = await fetch(`${API_BASE}/types`);
    if (!res.ok) throw new Error('Failed to fetch types');
    return res.json();
  },

  async addType(name) {
    const res = await fetch(`${API_BASE}/types`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!res.ok) throw new Error('Failed to add type');
    return res.json();
  },

  async removeType(name) {
    const res = await fetch(`${API_BASE}/types/${name}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Failed to remove type');
    return res.json();
  },

  // Stats
  async getStats(type) {
    const res = await fetch(`${API_BASE}/stats/${type}`);
    if (!res.ok) throw new Error('Failed to fetch stats');
    return res.json();
  }
};

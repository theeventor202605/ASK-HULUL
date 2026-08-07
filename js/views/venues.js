/**
 * HULUL - Venues admin view (SystemAdmin / EMCAdmin / EMCManager: create venues ahead of Events).
 */
async function renderVenues() {
  var root = document.getElementById('viewRoot');
  var venues = await Api.call('listVenues', {});
  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_venues') + '</div>' +
    '<div class="page-subtitle">Venues available to assign to Events</div></div>' +
    '<button class="btn btn-primary" id="newVenueBtn">+ New venue</button></div>' +
    '<div class="card"><div class="card-body">' + UI.table([
      { key: 'name', label: 'Name' }, { key: 'address', label: 'Address' }, { key: 'city', label: 'City' },
      { key: 'emcId', label: 'EMC Org ID' }, { key: 'createdAt', label: 'Created', render: r => UI.fmtDate(r.createdAt) }
    ], venues, {}) + '</div></div>';

  document.getElementById('newVenueBtn').onclick = function () {
    var body =
      UI.field('Name', '<input id="fVName" class="field-input" />') +
      UI.field('EMC Org ID', '<input id="fVEmc" class="field-input" placeholder="ORG-0001" />') +
      UI.field('Address', '<input id="fVAddress" class="field-input" />') +
      UI.field('City', '<input id="fVCity" class="field-input" />');
    UI.openModal('New venue', body, [
      { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
      { label: t('create'), className: 'btn-primary', onClick: async function () {
          try {
            await Api.call('createVenue', {
              name: document.getElementById('fVName').value, emcId: document.getElementById('fVEmc').value,
              address: document.getElementById('fVAddress').value, city: document.getElementById('fVCity').value
            });
            UI.closeModal(); UI.toast('Venue created', 'success'); Router.resolve();
          } catch (err) { UI.error(err); }
        } }
    ]);
  };
}

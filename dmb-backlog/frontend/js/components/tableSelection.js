export function reconcileSelection(selectedIds, items, canSelect = () => true) {
  const selectableIds = new Set(items.filter(canSelect).map(item => Number(item.id)));
  for (const id of selectedIds) {
    if (!selectableIds.has(Number(id))) selectedIds.delete(id);
  }
  return selectableIds;
}

export function setAllSelection(selectedIds, items, checked, canSelect = () => true) {
  const selectableIds = reconcileSelection(selectedIds, items, canSelect);
  selectableIds.forEach(id => {
    if (checked) selectedIds.add(id);
    else selectedIds.delete(id);
  });
  return selectableIds;
}

export function getSelectedItems(selectedIds, items) {
  return items.filter(item => selectedIds.has(Number(item.id)));
}

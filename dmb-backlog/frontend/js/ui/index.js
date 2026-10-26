// Public UI kit entry point. These adapters reuse the application's real
// dialog, state and feedback implementations, including their lifecycle.
export { attributes, icon, button, checkbox, badge, control, fieldFrame, field, filterChip, kpiCard, collapseSection, pageHeader, tab, tabs } from './primitives.js';
export { setButtonBusy, mountTabs, tabNavigationTarget } from './controls.js';
export { toggleSwitch } from './switch.js';
export { avatar, tag, progress } from './dataDisplay.js';
export { chartPalette, chartTheme, applyChartTheme, chartJsTheme, applyChartJsTheme, loadChartFont } from './charts.js';
export { renderViewState, bindViewStateAction } from '../components/viewState.js';
export { confirmAction, showToast, showFieldError, clearFieldError } from '../uiFeedback.js';
export { initModalAccessibility } from '../modalAccessibility.js';

export { createPopover, bindPopover } from './popover.js';
export { selectionList, filterSelectionList } from './selectionList.js';
export { bindActionMenu } from './actionMenu.js';
export { bindTooltip } from './tooltip.js';
export { pagination, radioGroup, alert } from './forms.js';

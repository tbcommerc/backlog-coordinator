import {readFileSync,readdirSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
function walk(p){return readdirSync(new URL(p,root),{withFileTypes:true}).flatMap(e=>e.isDirectory()?['lib','assistant-v2'].includes(e.name)?[]:walk(p+'/'+e.name):[p+'/'+e.name]);}
export const detectors={
 readOnlyField:/\breadOnlyField\b|\bdescriptionList\b|ui-readonly-field|ui-description-list/,
 sectionCard:/\bsectionCard\b|ui-section-card/,
 detailPanel:/\bdetailPanel\b|\bbindDetailPanel\b|ui-detail-panel/,
 dataTable:/\bdataTable\b|\bbindDataTable\b|ui-data-table/,
 tableCell:/\btableCell\b|ui-table-cell/,
 entityPicker:/\bentityPicker\b|\bbindEntityPicker\b|ui-entity-picker/,
 intervals:/\bdateRange\b|\bnumberRange\b|\bvalidateRanges\b|ui-interval/,
 stepForm:/\bstepForm\b|\bsetStepForm\b|\bbindStepForm\b|ui-step-form/,
 splitPane:/\bsplitPane\b|\bbindSplitPane\b|ui-split-pane/,
 pagination:/pagination|pager|data-page|next_cursor|load.more/i,
 search:/type=["']search|type:\s*['"]search|placeholder=["'][^"']*Поиск|searchInput|search-input/i,
 filter:/filterChip|quick-filter|filter-panel|filter-toolbar|data-filter/i,
 sorting:/aria-sort|data-sort|sort-dir|sortDirection|sort\.dir|Sort\.dir/,
 selection:/select.all|selectAll|selectedIds|selectedTasks|data-select|type=["']checkbox/i,
 bulk:/bulk|массов|выбранн.{0,25}задач/i,
 status:/badge|ui-tag|status-chip|stateBadge|workStatus/i,
 counter:/counter|quick-filter-count|unread-count|list-count|notif-badge|item-badge/i,
 tabs:/role=["']tab(?:list|panel)?["']|\btab\(|\btabs\(|-tabs\b|tabNavigationTarget/,
 dialog:/createElement\(['"]dialog|<dialog|role=["']dialog|modal-overlay|enhanceDialogOverlay|showModal/,
 confirmation:/confirmAction|window\.confirm|\bconfirm\(|\bshowConfirm\w*\s*\(|beforeunload|несохран/i,
 field:/uiControl|\bcontrol\(|uiField|\bfield\(|<input|<select|<textarea/,
 validation:/showFieldError|setCustomValidity|aria-invalid|field-error|reportValidity/,
 feedback:/showToast|\btoast\(|role=["']alert|formatErrorMessage/,
 viewState:/renderViewState|loading|empty-state|retry|Повторить/i,
 upload:/type=["']file|fileUpload|data-upload|FormData|dropzone/,
 progress:/\bprogress\b|progressbar|ui-progress|metric-progress/i,
 menu:/bindActionMenu|role=["']menu|dropdown-menu|action-menu/,
 tooltip:/bindTooltip|data-tooltip|title=["']/,
 popover:/createPopover|bindPopover|popover|dropdown/,
 navigation:/breadcrumb|location\.hash|router\.navigate|href=["']#\//,
 table:/<table|role=["']grid|ui-table|\bdataTable\b/,
 date:/type=["']date|datetime-local|date-picker|DatePicker|workDate/,
 chart:/<canvas|new Chart|chartTheme|chartPalette|<svg/,
 avatar:/ui-avatar|\bavatar\(|initials/,
 collapse:/<details|<summary|collapseSection|aria-expanded/,
 download:/download=|createObjectURL|exportCsv|exportExcel|data-export/i,
 drag:/draggable|dragstart|dragover|drop-target/,
 busy:/setButtonBusy|aria-busy|saving|isSubmitting/,
 permissions:/canEdit|canCreate|permissions|readonly|readOnly|forbidden/
};
const uiSymbolsByFamily={
 dataTable:['dataTable','bindDataTable'],tableCell:['tableCell'],
 entityPicker:['entityPicker','bindEntityPicker'],
 intervals:['dateRange','numberRange','validateRanges'],
 stepForm:['stepForm','setStepForm','bindStepForm'],splitPane:['splitPane','bindSplitPane'],
 readOnlyField:['readOnlyField','descriptionList','bindReadOnlyFields'],sectionCard:['sectionCard'],detailPanel:['detailPanel','bindDetailPanel'],
 pagination:['pagination','cursorPagination','loadMore'],search:['searchControl'],filter:['filterChip'],selection:['checkbox','selectionList','filterSelectionList'],status:['badge','tag'],counter:['counter','filterChip'],tabs:['tab','tabs','mountTabs','tabNavigationTarget'],dialog:['dialogShell','initModalAccessibility'],confirmation:['confirmAction'],field:['control','field','fieldFrame','toggleSwitch','radioGroup','fileUpload','datePicker','numberCell','rangeControl','searchControl'],validation:['showFieldError','clearFieldError','showFormErrors','clearFormErrors'],feedback:['showToast','alert'],viewState:['renderViewState','bindViewStateAction'],upload:['fileUpload'],progress:['progress'],menu:['bindActionMenu'],tooltip:['bindTooltip'],popover:['createPopover','bindPopover'],table:['tableShell','tableHeader','tableBody'],date:['datePicker'],chart:['chartPalette','chartTheme','applyChartTheme','chartJsTheme','applyChartJsTheme','loadChartFont'],avatar:['avatar'],collapse:['collapseSection'],busy:['setButtonBusy']
};
export function reviewUiImports(source){
 const entries=[];for(const m of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*(['"])([^'"]+)\2/g)){if(!/(?:^|\/)ui\/|\/uiFeedback\.js|\/modalAccessibility\.js/.test(m[3]))continue;for(const binding of m[1].split(',')){const pair=binding.trim().match(/^(\w+)(?:\s+as\s+(\w+))?$/);if(pair)entries.push({exported:pair[1],local:pair[2]||pair[1],from:m[3],line:source.slice(0,m.index).split('\n').length});}}return entries;
}
export function detectReviewFamilies(source){
 const lines=source.split(/\r?\n/),imports=reviewUiImports(source);return Object.entries(detectors).flatMap(([family,re])=>{const hits=[...new Set([...lines.flatMap((line,i)=>re.test(line)?[i+1]:[]),...imports.filter(entry=>(uiSymbolsByFamily[family]||[]).includes(entry.exported)).map(entry=>entry.line)])].sort((a,b)=>a-b);return hits.length?[{family,lines:hits}]:[];});
}
export function buildReviewInventory(){
 const modules=walk('js').filter(p=>p.endsWith('.js')).sort().map(path=>{
  const source=read(path),lines=source.split(/\r?\n/);
  return {path,sha256:createHash('sha256').update(source).digest('hex'),
   families:detectReviewFamilies(source),uiImports:reviewUiImports(source),
   entries:[...source.matchAll(/(?:export\s+)?(?:async\s+)?function\s+((?:render|open|show|init)\w+)\s*\(/g)].map(m=>({name:m[1],line:source.slice(0,m.index).split('\n').length})),
   imports:[...source.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"?]+)(?:\?[^'"]*)?\1/g)].map(m=>m[2])};
 });
 const router=read('js/router.js');
 const staticRoutes=[...router.split('this.routes = {')[1].split('};')[0].matchAll(/'([^']+)':\s*\{/g)].map(m=>m[1]);
 const routeEvidence=router.split(/\r?\n/).flatMap((text,i)=>/path\s*(?:===|\.startsWith|\.match)|\.test\(path\)|const .*Match =/.test(text)?[{line:i+1,text:text.trim()}]:[]);
 const historical=JSON.parse(read('ui-catalog/migration-matrix.json'));
 const surfaces=historical.surfaces.map(s=>({id:s.id,entry:s.entry,source:s.source.replace(/^frontend\//,''),title:s.title,declaredStates:s.states,priorTests:s.tests,code:existsSync(new URL(s.source.replace(/^frontend\//,''),root))?'present':'missing',live:'not-reverified',priorClaim:s.status}));
 const families=Object.keys(detectors).map(family=>({family,consumers:modules.filter(m=>!m.path.startsWith('js/ui/')&&m.families.some(f=>f.family===family)).map(m=>m.path)}));
 return {schema:1,scope:'Discovery candidates, not acceptance. Historical claims do not become current evidence. Review false positives, dynamic routes, roles and applicability.',staticRoutes,routeEvidence,surfaces,modules,families};
}
if(process.argv[1]?.endsWith('build-review-inventory.mjs')){
 const output=JSON.stringify(buildReviewInventory(),null,2)+'\n',url=new URL('ui-catalog/review-inventory.json',root);
 if(process.argv.includes('--check')){if(!existsSync(url)||readFileSync(url,'utf8')!==output)throw Error('Discovery changed: regenerate, review candidates and record dispositions. This check is not live acceptance.');}
 else writeFileSync(url,output);
}

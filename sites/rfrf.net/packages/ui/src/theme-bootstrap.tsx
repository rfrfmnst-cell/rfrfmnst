/** Inline bootstrap shared by replacement error documents. */
export const RAFRAF_THEME_BOOTSTRAP = [
  "(function(){var theme='light';try{",
  "var saved=localStorage.getItem('rafraf-theme');",
  "if(saved==='light'||saved==='dark')theme=saved;",
  '}catch(e){}',
  'var root=document.documentElement;',
  'root.dataset.theme=theme;',
  'root.style.colorScheme=theme;',
  'var meta=document.querySelector(\'meta[name="theme-color"]\');',
  "if(meta)meta.setAttribute('content',theme==='dark'?'#07101F':'#FBF8F2');",
  '})();',
].join('');

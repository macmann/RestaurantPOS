const path = window.location.pathname.replace(/\/$/, '');
if (path === '/manager' || path === '/order' || path === '/customergui') {
  void import('./remote-surfaces').then(({ renderRemoteSurface }) => renderRemoteSurface(path === '/manager' ? 'manager' : 'customer'));
} else {
  void import('./main');
}

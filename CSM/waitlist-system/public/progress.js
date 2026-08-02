function showProgress() {
  const bar = document.getElementById('progressBar');
  if (bar) bar.classList.add('active');
}

function hideProgress() {
  const bar = document.getElementById('progressBar');
  if (bar) bar.classList.remove('active');
}

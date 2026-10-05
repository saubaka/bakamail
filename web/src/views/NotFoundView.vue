<template>
  <div class="login-page">
    <main id="main-content" class="login-main" tabindex="-1">
      <section class="login-card card" aria-labelledby="not-found-title">
        <header class="login-heading">
          <span class="login-product-name">BakaMail · 404</span>
          <h1 id="not-found-title">页面不存在</h1>
          <p>这个地址无法打开，请检查链接。</p>
        </header>
        <nav class="login-secondary-nav" aria-label="可用页面">
          <router-link to="/">返回首页</router-link>
        </nav>
      </section>
    </main>
    <footer class="login-footer"><p>© {{ year }} saubaka · BakaMail</p></footer>
  </div>
</template>

<script setup lang="ts">
const year = new Date().getFullYear();
</script>

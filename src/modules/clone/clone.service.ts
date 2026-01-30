import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { TrackingCleanerService } from './tracking-cleaner.service';
import * as puppeteer from 'puppeteer';

interface ProcessOptions {
  editMode?: boolean;
  injectCustom?: boolean;
  pixelId?: string;
  gtagId?: string;
  whatsappNumber?: string;
  clarityId?: string;
  utmfyCode?: string;
}

interface CleaningStats {
  metaPixels: number;
  analyticsScripts: number;
  trackingScripts: number;
  webhooks: number;
}

export interface TrackingCode {
  type: string;
  category:
    | 'pixel'
    | 'analytics'
    | 'tag-manager'
    | 'social-media'
    | 'ecommerce'
    | 'affiliate'
    | 'monitoring'
    | 'other';
  name: string;
  domain?: string;
  identifier?: string;
  snippet: string;
  location: 'head' | 'body' | 'inline' | 'external';
  lineNumber?: number;
  risk: 'low' | 'medium' | 'high';
}

export interface TrackingAnalysisResult {
  totalFound: number;
  byCategory: {
    pixel: number;
    analytics: number;
    'tag-manager': number;
    'social-media': number;
    ecommerce: number;
    affiliate: number;
    monitoring: number;
    other: number;
  };
  trackers: TrackingCode[];
  summary: {
    facebookPixel: boolean;
    googleAnalytics: boolean;
    googleTagManager: boolean;
    microsoftClarity: boolean;
    utmfy: boolean;
    hotjar: boolean;
    customPixels: string[];
  };
}

@Injectable()
export class CloneService {
  constructor(private readonly trackingCleaner: TrackingCleanerService) {}

  /**
   * 🎯 NOVA ABORDAGEM: Cópia Estática Independente
   * Faz fetch UMA VEZ, processa e armazena cópia limpa
   */
  async fetchAndProcessPage(
    url: string,
    options: ProcessOptions
  ): Promise<{ html: string; stats: CleaningStats }> {
    try {
      // Validar URL
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new HttpException('Invalid URL protocol', HttpStatus.BAD_REQUEST);
      }

      // 1️⃣ FETCH - Fazer requisição UMA VEZ
      console.log(`📥 [CloneService] Fazendo fetch de: ${url}`);
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (!response.ok) {
        throw new HttpException(
          `Failed to fetch page: ${response.status} ${response.statusText}`,
          HttpStatus.BAD_GATEWAY
        );
      }

      let html = await response.text();
      const htmlSizeKB = html.length / 1024;

      console.log(`📏 [fetchAndProcessPage] Tamanho do HTML: ${htmlSizeKB.toFixed(2)} KB`);

      // 🔍 DETECÇÃO AUTOMÁTICA: Verificar se é site Next.js
      // Sites Next.js com RSC/SSR precisam de Puppeteer para renderização completa
      const isNextJs = html.includes('__NEXT_DATA__') || html.includes('/_next/');

      // 🔍 DETECÇÃO AUTOMÁTICA: Verificar se é site Lovable (plataforma SPA)
      // Sites Lovable são SPAs com routing interno que mostram 404 em iframe
      const isLovable = url.includes('lovable') ||
                        url.includes('afiliadamayra') ||
                        html.includes('lovable') ||
                        html.includes('404 Error: User attempted to access non-existent route');

      // 🔍 DETECÇÃO AUTOMÁTICA: Verificar se é site Aura.build
      // Sites Aura usam iframe com srcdoc para o conteúdo real
      const isAura = url.includes('aura.build') ||
                     html.includes('Made in Aura') ||
                     html.includes('aura.build') ||
                     html.includes('unicornstudio');

      // 🔍 DETECÇÃO AUTOMÁTICA: Verificar recursos externos que podem causar CORS
      // Detecta CSS e JS externos que apontam para domínios diferentes
      const baseDomain = urlObj.hostname;
      
      // Buscar todos os links de CSS externos
      const externalCssLinks = html.match(/<link[^>]*rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi) || [];
      // Buscar todos os scripts externos
      const externalScripts = html.match(/<script[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi) || [];
      
      let hasExternalResources = false;
      let externalResourceCount = 0;
      
      // Verificar se há recursos externos de domínios diferentes
      const checkExternalResource = (resourceUrl: string): boolean => {
        try {
          // Se começa com //, é protocolo relativo (mesmo domínio)
          if (resourceUrl.startsWith('//')) {
            return false;
          }
          // Se começa com /, é caminho relativo (mesmo domínio)
          if (resourceUrl.startsWith('/')) {
            return false;
          }
          // Se começa com data:, é inline (não é externo)
          if (resourceUrl.startsWith('data:')) {
            return false;
          }
          // Se começa com http:// ou https://, verificar domínio
          if (resourceUrl.startsWith('http://') || resourceUrl.startsWith('https://')) {
            const resourceUrlObj = new URL(resourceUrl);
            return resourceUrlObj.hostname !== baseDomain;
          }
          // URLs relativas não são externas
          return false;
        } catch {
          return false;
        }
      };
      
      // Verificar CSS externos
      externalCssLinks.forEach(link => {
        const hrefMatch = link.match(/href\s*=\s*["']([^"']+)["']/i);
        if (hrefMatch && hrefMatch[1]) {
          if (checkExternalResource(hrefMatch[1])) {
            hasExternalResources = true;
            externalResourceCount++;
          }
        }
      });
      
      // Verificar scripts externos
      externalScripts.forEach(script => {
        const srcMatch = script.match(/src\s*=\s*["']([^"']+)["']/i);
        if (srcMatch && srcMatch[1]) {
          if (checkExternalResource(srcMatch[1])) {
            hasExternalResources = true;
            externalResourceCount++;
          }
        }
      });
      
      const needsPuppeteerForCors = hasExternalResources && externalResourceCount > 0;

      console.log('🔍 [fetchAndProcessPage] Análise de detecção:', {
        isNextJs,
        isLovable,
        isAura,
        hasExternalResources,
        externalResourceCount,
        htmlSizeKB: htmlSizeKB.toFixed(2),
        willUsePuppeteer: isNextJs || isLovable || isAura || needsPuppeteerForCors
      });

      // 🎯 SOLUÇÃO DEFINITIVA: Se é Next.js ou Lovable, SEMPRE usar Puppeteer
      // Next.js usa renderização via JavaScript que não funciona em iframe cross-origin
      // Lovable tem SPA routing que mostra 404 quando URL é interpretada como rota interna
      if (isNextJs) {
        console.log('🔄 [fetchAndProcessPage] Site Next.js DETECTADO!');
        console.log('   - HTML size: ' + htmlSizeKB.toFixed(2) + ' KB');
        console.log('   - Motivo: Next.js renderiza conteúdo via JavaScript e precisa de servidor');
        console.log('🚀 [fetchAndProcessPage] USANDO PUPPETEER para renderização completa...');

        // Usar Puppeteer para capturar HTML renderizado
        return await this.cloneWithPuppeteer(url, options);
      }

      if (isLovable) {
        console.log('🔄 [fetchAndProcessPage] Site LOVABLE DETECTADO!');
        console.log('   - HTML size: ' + htmlSizeKB.toFixed(2) + ' KB');
        console.log('   - Motivo: Lovable SPA com routing interno mostra 404 em iframe');
        console.log('🚀 [fetchAndProcessPage] USANDO PUPPETEER para contornar proteções...');

        // Usar Puppeteer para capturar HTML renderizado
        return await this.cloneWithPuppeteer(url, options);
      }

      // 🎯 DETECÇÃO AURA.BUILD: Sites que usam iframe com srcdoc
      if (isAura) {
        console.log('🔄 [fetchAndProcessPage] Site AURA.BUILD DETECTADO!');
        console.log('   - HTML size: ' + htmlSizeKB.toFixed(2) + ' KB');
        console.log('   - Motivo: Aura usa iframe com srcdoc para o conteúdo real');
        console.log('🚀 [fetchAndProcessPage] USANDO PUPPETEER para extrair conteúdo do iframe...');

        // Usar Puppeteer para capturar HTML renderizado do iframe
        return await this.cloneWithPuppeteer(url, options);
      }

      // 🎯 NOVA DETECÇÃO: Recursos externos que podem causar CORS
      // Se há CSS/JS externos de outros domínios, usar Puppeteer para fazer inline
      if (needsPuppeteerForCors) {
        console.log('🔄 [fetchAndProcessPage] Recursos EXTERNOS DETECTADOS!');
        console.log('   - HTML size: ' + htmlSizeKB.toFixed(2) + ' KB');
        console.log('   - Recursos externos encontrados: ' + externalResourceCount);
        console.log('   - Motivo: Recursos CSS/JS externos podem ser bloqueados por CORS');
        console.log('   - Solução: Usar Puppeteer para fazer inline dos recursos');
        console.log('🚀 [fetchAndProcessPage] USANDO PUPPETEER para evitar problemas de CORS...');

        // Usar Puppeteer para fazer inline de recursos e evitar CORS
        return await this.cloneWithPuppeteer(url, options);
      }

      const originalHtml = html; // Guardar HTML original para validação

      // 2️⃣ PROCESSAR - Limpar tracking codes (NOVA LIMPEZA CIRÚRGICA)
      const stats = this.getCleaningStats();

      // 🎯 USAR NOVO SERVIÇO CIRÚRGICO DE LIMPEZA
      // Remove APENAS tracking codes, preserva 100% de CSS, JavaScript funcional e imagens
      html = this.trackingCleaner.cleanTrackingCodes(html, stats);

      // 🛡️ VALIDAR que código essencial foi preservado
      const validation = this.trackingCleaner.validatePreservation(originalHtml, html);
      if (validation.warnings.length > 0) {
        console.warn('⚠️ AVISOS DE VALIDAÇÃO:');
        validation.warnings.forEach(warning => console.warn(warning));
      } else {
        console.log('✅ VALIDAÇÃO: CSS, JavaScript e imagens preservados com sucesso!');
      }

      // 🚀 Desabilitar React Server Components do Next.js (causam erro "Connection closed")
      html = this.disableNextJsRSC(html);

      html = this.convertRelativeUrls(html, url);
      html = this.disableWPRocket(html); // 🚀 Desativar WP Rocket lazy loading

      // 3️⃣ INJETAR - Adicionar custom codes se configurado
      // ✅ DEBUG: Log ANTES da injeção
      console.log('🔧 [fetchAndProcessPage] ANTES da injeção:', {
        injectCustom: options.injectCustom,
        pixelId: options.pixelId ? '***' : 'undefined',
        gtagId: options.gtagId ? '***' : 'undefined',
        whatsappNumber: options.whatsappNumber ? '***' : 'undefined',
        clarityId: options.clarityId ? '***' : 'undefined',
        utmfyCode: options.utmfyCode ? '(preenchido)' : 'undefined',
        htmlSizeAntes: html.length,
      });

      html = this.processHtml(html, url, options);

      // ✅ DEBUG: Log DEPOIS da injeção
      console.log('✅ [fetchAndProcessPage] DEPOIS da injeção:', {
        htmlSizeDepois: html.length,
        pixelInjetado: options.pixelId ? html.includes(options.pixelId) : 'N/A',
        gtagInjetado: options.gtagId ? html.includes(options.gtagId) : 'N/A',
        whatsappInjetado: options.whatsappNumber
          ? html.includes(options.whatsappNumber)
          : 'N/A',
      });

      console.log(
        `✅ [CloneService] HTML processado. Pixel removidos: ${stats.metaPixels}, Analytics: ${stats.analyticsScripts}`
      );

      return { html, stats };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Error fetching page: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * 🚀 PUPPETEER FALLBACK: Clonagem com navegador headless
   * Usado automaticamente quando fetch simples retorna HTML vazio/incompleto
   */
  async cloneWithPuppeteer(
    url: string,
    options: ProcessOptions
  ): Promise<{ html: string; stats: CleaningStats }> {
    console.log('🤖 [Puppeteer] Iniciando clonagem com navegador headless...');

    let browser: puppeteer.Browser | null = null;

    try {
      // 1️⃣ Lançar navegador
      console.log('🤖 [Puppeteer] Lançando navegador...');
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security',
        ],
      });

      // 2️⃣ Criar página
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // 3️⃣ Navegar e esperar JavaScript executar
      console.log(`🤖 [Puppeteer] Navegando para: ${url}`);
      await page.goto(url, {
        waitUntil: 'networkidle2', // Aguarda até rede ficar ociosa
        timeout: 45000, // Aumentado: 30s → 45s para sites mais pesados
      });

      // 4️⃣ Aguardar renderização inicial completa
      console.log('🤖 [Puppeteer] Aguardando renderização inicial completa...');
      await new Promise(resolve => setTimeout(resolve, 3000)); // Aumentado: 1.5s → 3s

      // 4.5️⃣ 🎨 NOVO: Aguardar CSS carregar completamente (CRITICAL para Lovable)
      console.log('🎨 [Puppeteer] Aguardando todos os stylesheets carregarem...');
      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          // Verificar se todos os <link rel="stylesheet"> estão carregados
          const styleSheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
          const totalSheets = styleSheets.length;
          console.log(`🎨 [Puppeteer-Browser] Encontrados ${totalSheets} stylesheets para carregar`);

          if (totalSheets === 0) {
            console.log('🎨 [Puppeteer-Browser] Nenhum stylesheet externo, verificando inline...');
            // Verificar se há CSS inline ou <style> tags
            const styleTags = document.querySelectorAll('style').length;
            console.log(`🎨 [Puppeteer-Browser] ${styleTags} <style> tags encontradas`);
            resolve();
            return;
          }

          let loadedSheets = 0;
          const checkAllLoaded = () => {
            loadedSheets++;
            console.log(`🎨 [Puppeteer-Browser] Stylesheet ${loadedSheets}/${totalSheets} carregado`);
            if (loadedSheets >= totalSheets) {
              console.log('✅ [Puppeteer-Browser] Todos os stylesheets carregados!');
              resolve();
            }
          };

          // Para cada stylesheet, verificar se já está carregado ou aguardar evento load
          styleSheets.forEach((link: Element) => {
            const linkElement = link as HTMLLinkElement;
            // Se já carregou (sheet existe), contar como carregado
            if (linkElement.sheet) {
              checkAllLoaded();
            } else {
              // Se ainda não carregou, aguardar evento load
              linkElement.addEventListener('load', checkAllLoaded);
              linkElement.addEventListener('error', () => {
                console.warn(`⚠️ [Puppeteer-Browser] Erro ao carregar: ${linkElement.href}`);
                checkAllLoaded(); // Continuar mesmo com erro
              });
            }
          });

          // Timeout de segurança: se não carregar em 15s, continuar mesmo assim
          setTimeout(() => {
            if (loadedSheets < totalSheets) {
              console.warn(`⚠️ [Puppeteer-Browser] Timeout: ${loadedSheets}/${totalSheets} carregados após 15s`);
              resolve();
            }
          }, 15000); // Aumentado: 10s → 15s para sites com muitos CSS
        });
      });
      console.log('✅ [Puppeteer] CSS carregado completamente!');

      // 5️⃣ Remover lazy loading de TODAS as imagens para forçar carregamento imediato
      console.log('🤖 [Puppeteer] Removendo lazy loading de imagens...');
      await page.evaluate(() => {
        // Remover loading="lazy" de todas as imagens
        document.querySelectorAll('img[loading="lazy"]').forEach((img) => {
          const imgEl = img as HTMLImageElement;
          imgEl.removeAttribute('loading');
          // Se tiver data-src, trocar por src
          const dataSrc = imgEl.getAttribute('data-src');
          if (dataSrc && !imgEl.src) {
            imgEl.src = dataSrc;
          }
        });
        console.log('✅ [Puppeteer] Lazy loading removido de', document.querySelectorAll('img').length, 'imagens');
      });

      // 6️⃣ Fazer scroll automático SUAVE para carregar conteúdo lazy-load
      console.log('🤖 [Puppeteer] Fazendo scroll suave para carregar todo conteúdo...');
      await page.evaluate(async () => {
        // Função para fazer scroll suave até o final da página
        await new Promise<void>((resolve) => {
          let totalHeight = 0;
          const distance = 400; // Scroll 400px por vez (suave)
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;

            // Adicionar margem extra de 1000px para garantir que pegue tudo
            if(totalHeight >= scrollHeight + 1000){
              clearInterval(timer);
              // Forçar scroll até o final absoluto
              window.scrollTo(0, document.body.scrollHeight);
              resolve();
            }
          }, 150); // Aumentado: 100ms → 150ms para dar tempo de carregamento
        });
      });

      // 7️⃣ Aguardar carregamento completo de todos os recursos
      console.log('🤖 [Puppeteer] Aguardando carregamento completo de todos os recursos (4s)...');
      await new Promise(resolve => setTimeout(resolve, 4000)); // Aumentado: 2s → 4s

      // 8️⃣ Voltar para o topo antes de processar
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });

      // 8.5️⃣ Aguardar todas as imagens carregarem
      console.log('🖼️ [Puppeteer] Aguardando carregamento de todas as imagens...');
      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          const images = Array.from(document.querySelectorAll('img'));
          let loadedImages = 0;
          const totalImages = images.length;

          if (totalImages === 0) {
            console.log('🖼️ [Puppeteer-Browser] Nenhuma imagem encontrada');
            resolve();
            return;
          }

          console.log(`🖼️ [Puppeteer-Browser] Aguardando ${totalImages} imagens...`);

          const checkImage = () => {
            loadedImages++;
            if (loadedImages >= totalImages) {
              console.log(`✅ [Puppeteer-Browser] Todas as ${totalImages} imagens carregadas!`);
              resolve();
            }
          };

          images.forEach((img) => {
            if (img.complete && img.naturalHeight !== 0) {
              checkImage();
            } else {
              img.addEventListener('load', checkImage);
              img.addEventListener('error', checkImage); // Contar mesmo se falhar
            }
          });

          // Timeout: continuar após 8s mesmo se algumas imagens não carregarem
          setTimeout(() => {
            if (loadedImages < totalImages) {
              console.warn(`⚠️ [Puppeteer-Browser] Timeout: ${loadedImages}/${totalImages} imagens carregadas`);
              resolve();
            }
          }, 8000);
        });
      });
      console.log('✅ [Puppeteer] Todas as imagens processadas!');

      // 8️⃣ 💉 NOVO: Inline CSS e JS
      console.log('💉 [Puppeteer] Fazendo inline de CSS e JS...');
      await page.evaluate(async (baseUrl: string) => {
        let inlinedCss = 0;
        let convertedUrls = 0;

        // 1️⃣ Inline CSS de <link rel="stylesheet">
        const styleLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'));
        for (const link of styleLinks) {
          const linkEl = link as HTMLLinkElement;
          const href = linkEl.getAttribute('href');
          if (!href) continue;

          try {
            // Resolver URL absoluta
            const absoluteUrl = href.startsWith('http') || href.startsWith('//')
              ? href
              : new URL(href, baseUrl).href;

            // Buscar CSS
            const response = await fetch(absoluteUrl);
            if (response.ok) {
              let cssText = await response.text();

              // Converter URLs dentro do CSS para absolutas
              cssText = cssText.replace(
                /url\(['"]?([^'"()]+)['"]?\)/gi,
                (match, urlPath) => {
                  if (urlPath.startsWith('http') || urlPath.startsWith('//') || urlPath.startsWith('data:')) {
                    return match;
                  }
                  try {
                    // Resolver relativo ao arquivo CSS, não à página base
                    const cssBaseUrl = absoluteUrl.substring(0, absoluteUrl.lastIndexOf('/') + 1);
                    const absoluteAssetUrl = new URL(urlPath, cssBaseUrl).href;
                    return `url('${absoluteAssetUrl}')`;
                  } catch {
                    return match;
                  }
                }
              );

              // Criar <style> inline
              const styleTag = document.createElement('style');
              styleTag.textContent = cssText;
              styleTag.setAttribute('data-inlined-from', absoluteUrl);

              // Substituir <link> por <style>
              linkEl.parentNode?.replaceChild(styleTag, linkEl);
              inlinedCss++;
              console.log(`✅ [Puppeteer-Browser] CSS inlined: ${absoluteUrl.substring(0, 60)}...`);
            }
          } catch (error: any) {
            console.warn(`⚠️ [Puppeteer-Browser] Erro ao inline CSS: ${href}`, error?.message);
          }
        }

        // 2️⃣ Converter <img src="..."> para absolutas
        document.querySelectorAll('img[src]').forEach((img: Element) => {
          const imgEl = img as HTMLImageElement;
          const src = imgEl.getAttribute('src');
          if (src && !src.startsWith('http') && !src.startsWith('//') && !src.startsWith('data:')) {
            const absoluteUrl = new URL(src, baseUrl).href;
            imgEl.setAttribute('src', absoluteUrl);
            convertedUrls++;
          }
        });

        // 3️⃣ Converter URLs em CSS inline (style tags existentes)
        document.querySelectorAll('style').forEach((style: Element) => {
          const styleEl = style as HTMLStyleElement;
          if (styleEl.textContent && !styleEl.getAttribute('data-inlined-from')) {
            styleEl.textContent = styleEl.textContent.replace(
              /url\(['"]?([^'"()]+)['"]?\)/gi,
              (match, urlPath) => {
                if (urlPath.startsWith('http') || urlPath.startsWith('//') || urlPath.startsWith('data:')) {
                  return match;
                }
                try {
                  const absoluteUrl = new URL(urlPath, baseUrl).href;
                  convertedUrls++;
                  return `url('${absoluteUrl}')`;
                } catch {
                  return match;
                }
              }
            );
          }
        });

        console.log(`✅ [Puppeteer-Browser] Inline completo: ${inlinedCss} CSS inlined, ${convertedUrls} URLs convertidas`);
      }, url);
      console.log('✅ [Puppeteer] CSS inline completo!');

      // 8️⃣ Aguardar estabilização após inline de CSS
      console.log('⏳ [Puppeteer] Aguardando estabilização final (2s)...');
      await new Promise(resolve => setTimeout(resolve, 2000)); // Novo: 2s para estabilização

      // 9️⃣ Capturar HTML renderizado
      console.log('🤖 [Puppeteer] Capturando HTML renderizado...');

      // 🎯 AURA.BUILD: Detectar e extrair HTML do iframe principal ANTES de capturar
      // Sites Aura usam iframe com srcdoc - precisamos extrair o conteúdo do iframe renderizado
      const isAuraSite = url.includes('aura.build');
      
      let html: string;
      
      if (isAuraSite) {
        console.log('🔍 [Puppeteer] Site Aura.build detectado - extraindo HTML do iframe...');
        
        // 🎨 CAPTURAR CANVAS COMO IMAGEM (para animações WebGL como Unicorn Studio)
        console.log('🎨 [Puppeteer] Capturando canvas animado como imagem estática...');
        const canvasDataUrl = await page.evaluate(() => {
          // Buscar o iframe principal
          const mainIframe = document.querySelector('iframe.w-full.h-screen') as HTMLIFrameElement;
          if (!mainIframe || !mainIframe.contentDocument) {
            console.log('⚠️ [Puppeteer-Browser] Iframe não acessível para captura de canvas');
            return null;
          }
          
          const iframeDoc = mainIframe.contentDocument;
          
          // Buscar canvas (Unicorn Studio ou similar)
          const canvas = iframeDoc.querySelector('canvas') as HTMLCanvasElement;
          if (!canvas) {
            console.log('ℹ️ [Puppeteer-Browser] Nenhum canvas encontrado');
            return null;
          }
          
          try {
            // Capturar canvas como PNG base64
            const dataUrl = canvas.toDataURL('image/png');
            console.log(`✅ [Puppeteer-Browser] Canvas capturado: ${canvas.width}x${canvas.height}`);
            return {
              dataUrl,
              width: canvas.width,
              height: canvas.height,
              style: canvas.getAttribute('style') || ''
            };
          } catch (e) {
            console.warn('⚠️ [Puppeteer-Browser] Erro ao capturar canvas (pode ser CORS):', e);
            return null;
          }
        });
        
        // Tentar extrair HTML diretamente do iframe renderizado
        html = await page.evaluate((canvasData) => {
          // Buscar o iframe principal do Aura (geralmente o maior iframe com srcdoc)
          const iframes = Array.from(document.querySelectorAll('iframe[srcdoc]'));
          
          if (iframes.length > 0) {
            // Pegar o maior iframe (provavelmente o principal)
            let mainIframe: HTMLIFrameElement | null = null;
            let maxSize = 0;
            
            for (const iframe of iframes) {
              const iframeEl = iframe as HTMLIFrameElement;
              const size = iframeEl.offsetWidth * iframeEl.offsetHeight;
              if (size > maxSize) {
                maxSize = size;
                mainIframe = iframeEl;
              }
            }
            
            if (mainIframe && mainIframe.contentDocument) {
              console.log('✅ [Puppeteer-Browser] Extraindo HTML do iframe Aura via contentDocument');
              const iframeDoc = mainIframe.contentDocument;
              
              // 🎨 Substituir canvas por imagem estática
              if (canvasData && canvasData.dataUrl) {
                const canvas = iframeDoc.querySelector('canvas');
                if (canvas && canvas.parentElement) {
                  console.log('🎨 [Puppeteer-Browser] Substituindo canvas por imagem estática...');
                  
                  // Criar imagem com o conteúdo do canvas
                  const img = iframeDoc.createElement('img');
                  img.src = canvasData.dataUrl;
                  img.alt = 'Background Animation';
                  img.style.cssText = canvasData.style || canvas.getAttribute('style') || '';
                  img.style.width = '100%';
                  img.style.height = '100%';
                  img.style.objectFit = 'cover';
                  img.style.position = 'absolute';
                  img.style.top = '0';
                  img.style.left = '0';
                  img.style.zIndex = '-1';
                  img.className = 'unicorn-studio-fallback';
                  
                  // Substituir canvas pela imagem
                  canvas.parentElement.replaceChild(img, canvas);
                  console.log('✅ [Puppeteer-Browser] Canvas substituído por imagem estática');
                }
              }
              
              // Remover scripts do Unicorn Studio (não funcionam sem o canvas original)
              const unicornScripts = iframeDoc.querySelectorAll('script[src*="unicorn"], script[src*="unicornstudio"]');
              unicornScripts.forEach(script => script.remove());
              console.log(`🗑️ [Puppeteer-Browser] Removidos ${unicornScripts.length} scripts Unicorn Studio`);
              
              // Remover scripts inline que inicializam Unicorn Studio
              const inlineScripts = iframeDoc.querySelectorAll('script:not([src])');
              inlineScripts.forEach(script => {
                if (script.textContent && script.textContent.includes('unicornstudio')) {
                  script.remove();
                }
              });
              
              const doctype = iframeDoc.doctype
                ? `<!DOCTYPE ${iframeDoc.doctype.name}>`
                : '<!DOCTYPE html>';
              return doctype + '\n' + iframeDoc.documentElement.outerHTML;
            }
            
            // Fallback: extrair do atributo srcdoc e decodificar
            if (mainIframe) {
              const srcdoc = mainIframe.getAttribute('srcdoc');
              if (srcdoc) {
                console.log('⚠️ [Puppeteer-Browser] Usando srcdoc como fallback');
                // Decodificar entidades HTML
                const textarea = document.createElement('textarea');
                textarea.innerHTML = srcdoc;
                return textarea.value;
              }
            }
          }
          
          // Se não encontrar iframe, retornar HTML normal
          console.log('ℹ️ [Puppeteer-Browser] Nenhum iframe Aura encontrado, usando HTML normal');
          const doctype = document.doctype
            ? `<!DOCTYPE ${document.doctype.name}>`
            : '<!DOCTYPE html>';
          return doctype + '\n' + document.documentElement.outerHTML;
        }, canvasDataUrl);
        
        console.log(`🤖 [Puppeteer] HTML do iframe Aura capturado: ${(html.length / 1024).toFixed(2)} KB`);
        
        if (canvasDataUrl) {
          console.log(`🎨 [Puppeteer] Canvas convertido para imagem: ${canvasDataUrl.width}x${canvasDataUrl.height}`);
        }
      } else {
        // 🎯 CRITICAL FIX: Capturar HTML do DOM ANTES de remover scripts
        // Sites Next.js/React podem ter conteúdo que só existe no DOM após renderização
        // Se capturarmos apenas o HTML estático, perdemos o conteúdo renderizado
        html = await page.evaluate(() => {
          // Clonar o document completo para manipular sem afetar a página
          const docClone = document.cloneNode(true) as Document;
          const htmlElement = docClone.documentElement;

          // Retornar o HTML completo incluindo doctype
          const doctype = document.doctype
            ? `<!DOCTYPE ${document.doctype.name}>`
            : '<!DOCTYPE html>';

          return doctype + '\n' + htmlElement.outerHTML;
        });

        console.log(`🤖 [Puppeteer] HTML capturado: ${(html.length / 1024).toFixed(2)} KB`);
      }

      // 🎯 AURA.BUILD: Limpeza adicional de elementos do Aura
      // A extração do iframe já foi feita acima, aqui apenas limpamos resíduos
      const isAuraPage = url.includes('aura.build') || html.includes('Made in Aura') || html.includes('aura.build');
      if (isAuraPage) {
        console.log('🧹 [Puppeteer] Limpando resíduos do Aura.build...');
        
        // Remover container wrapper do Aura (div que contém o badge)
        // O Aura adiciona um container com position:fixed no canto inferior esquerdo
        const auraContainerPatterns = [
          // Container com link para aura.build (mais específico)
          /<a[^>]*href=["'][^"']*aura\.build[^"']*["'][^>]*>[\s\S]*?<\/a>/gi,
          // Spans com "Made in Aura"
          /<span[^>]*>[\s\S]*?Made in Aura[\s\S]*?<\/span>/gi,
          // Qualquer elemento com data-aura ou similar
          /<[^>]*data-aura[^>]*>[\s\S]*?<\/[^>]+>/gi,
          // Imagens do logo Aura
          /<img[^>]*(?:aura|logo-aura)[^>]*>/gi
        ];
        
        let auraElementsRemoved = 0;
        for (const pattern of auraContainerPatterns) {
          const matches = html.match(pattern) || [];
          if (matches.length > 0) {
            html = html.replace(pattern, '');
            auraElementsRemoved += matches.length;
          }
        }
        
        if (auraElementsRemoved > 0) {
          console.log(`   🗑️ Removidos ${auraElementsRemoved} containers/elementos do Aura`);
        }
      }

      // 🔍 DIAGNÓSTICO: Verificar conteúdo capturado
      const bodyContent = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      if (bodyContent) {
        const bodyText = bodyContent[1];
        const sectionCount = (bodyText.match(/<section/gi) || []).length;
        const divCount = (bodyText.match(/<div/gi) || []).length;
        const textLength = bodyText.replace(/<[^>]*>/g, '').trim().length;

        console.log(`📊 [Puppeteer] Diagnóstico do conteúdo capturado:`, {
          sections: sectionCount,
          divs: divCount,
          textoVisivel: `${textLength} caracteres`,
          temConteudo: textLength > 100
        });

        if (textLength < 100) {
          console.warn('⚠️ [Puppeteer] AVISO: Pouco conteúdo de texto detectado! Possível problema de renderização.');
        }
      }

      // 🔟 Fechar navegador
      await browser.close();
      browser = null;

      // 🎯 NOVO: Remover scripts do React Router para sites Lovable/SPA
      if (url.includes('lovable') || url.includes('afiliadamayra') || html.includes('lovable')) {
        console.log('🧹 [Puppeteer] Removendo scripts do React Router (Lovable/SPA)...');

        // Remover todos os scripts de bundle que contém React Router
        const lovableScriptsBefore = (html.match(/<script[^>]*src\s*=\s*["'][^"']*\/assets\/index-[^"']*\.js["'][^>]*>\s*<\/script>/gi) || []).length;
        html = html.replace(/<script[^>]*src\s*=\s*["'][^"']*\/assets\/index-[^"']*\.js["'][^>]*>\s*<\/script>/gi, '');
        if (lovableScriptsBefore > 0) {
          console.log(`   🗑️  Removidos ${lovableScriptsBefore} scripts bundle Lovable`);
        }

        // Remover módulos do Vite (usado pelo Lovable)
        const viteScriptsBefore = (html.match(/<script[^>]*type\s*=\s*["']module["'][^>]*>\s*import[\s\S]*?<\/script>/gi) || []).length;
        html = html.replace(/<script[^>]*type\s*=\s*["']module["'][^>]*>\s*import[\s\S]*?<\/script>/gi, '');
        if (viteScriptsBefore > 0) {
          console.log(`   🗑️  Removidos ${viteScriptsBefore} scripts módulos Vite`);
        }

        console.log('✅ [Puppeteer] Scripts do React Router removidos - HTML agora é estático');
      }

      // 🏷️ NOVO: Remover badges "Made with Lovable", "Made with v0" e "Made in Aura"
      // ⚠️ IMPORTANTE: Executar SEMPRE, não apenas para sites específicos
      console.log('🏷️ [Puppeteer] Removendo badges de branding (Lovable/V0/Aura)...');

      let badgesRemoved = 0;

      // 🎯 ESPECÍFICO: Remover badge do Lovable (ID "lovable-badge")
      // 1. Remover CSS do badge Lovable
      const lovableCssPattern = /#lovable-badge\s*\{[^}]*\}/gi;
      const lovableCssBefore = (html.match(lovableCssPattern) || []).length;
      html = html.replace(lovableCssPattern, '');
      if (lovableCssBefore > 0) {
        console.log(`   🗑️  Removido ${lovableCssBefore} CSS do badge Lovable`);
      }

      // 2. Remover scripts relacionados ao lovable-badge
      const lovableScriptPattern = /<script[^>]*>(?:(?!<\/script>)[\s\S])*?lovable-badge(?:(?!<\/script>)[\s\S])*?<\/script>/gi;
      const lovableScriptBefore = (html.match(lovableScriptPattern) || []).length;
      html = html.replace(lovableScriptPattern, '');
      if (lovableScriptBefore > 0) {
        console.log(`   🗑️  Removidos ${lovableScriptBefore} scripts do badge Lovable`);
      }

      // 3. Remover elemento <a id="lovable-badge"> (usando padrão robusto para HTML minificado)
      const lovableBadgePattern = /<a[^>]*id\s*=\s*["']lovable-badge["'][^>]*>(?:(?!<\/a>)[\s\S])*?<\/a>/gi;
      const lovableBadgeBefore = (html.match(lovableBadgePattern) || []).length;
      html = html.replace(lovableBadgePattern, '');
      badgesRemoved += lovableBadgeBefore;
      if (lovableBadgeBefore > 0) {
        console.log(`   🗑️  Removidos ${lovableBadgeBefore} elementos <a> do badge Lovable`);
      }

      // 🎯 ESPECÍFICO: Remover badge do V0 (ID "v0-built-with-button-*")
      // Usar padrão que funciona com HTML minificado (inline)
      // Captura desde <div id="v0-built-with-button-"> até </div> correspondente
      const v0ButtonPattern = /<div[^>]*id\s*=\s*["']v0-built-with-button-[^"']*["'][^>]*>(?:(?!<\/div>)[\s\S])*?<\/div>/gi;
      const v0ButtonBefore = (html.match(v0ButtonPattern) || []).length;
      html = html.replace(v0ButtonPattern, '');
      badgesRemoved += v0ButtonBefore;
      if (v0ButtonBefore > 0) {
        console.log(`   🗑️  Removidos ${v0ButtonBefore} badges V0 (ID específico)`);
      }

      // 🎯 ESPECÍFICO: Remover badge do Aura.build (link "Made in Aura")
      // 1. Remover link com "aura.build" e texto "Made in Aura"
      const auraBadgePattern = /<a[^>]*(?:href=["'][^"']*aura\.build[^"']*["'])[^>]*>(?:(?!<\/a>)[\s\S])*?(?:Made in Aura|Aura Logo)(?:(?!<\/a>)[\s\S])*?<\/a>/gi;
      const auraBadgeBefore = (html.match(auraBadgePattern) || []).length;
      html = html.replace(auraBadgePattern, '');
      badgesRemoved += auraBadgeBefore;
      if (auraBadgeBefore > 0) {
        console.log(`   🗑️  Removidos ${auraBadgeBefore} badges Aura.build`);
      }
      
      // 2. Remover qualquer link com href para aura.build (fallback mais amplo)
      const auraLinkPattern = /<a[^>]*href=["'][^"']*aura\.build[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;
      const auraLinkBefore = (html.match(auraLinkPattern) || []).length;
      html = html.replace(auraLinkPattern, '');
      if (auraLinkBefore > 0) {
        badgesRemoved += auraLinkBefore;
        console.log(`   🗑️  Removidos ${auraLinkBefore} links para aura.build`);
      }
      
      // 3. Remover container fixo do badge Aura (geralmente position: fixed no canto)
      // Padrão: div com position fixed/absolute contendo aura.build ou Made in Aura
      const auraFixedContainerPattern = /<div[^>]*style=["'][^"']*(?:position:\s*(?:fixed|absolute))[^"']*["'][^>]*>[\s\S]*?(?:aura\.build|Made in Aura)[\s\S]*?<\/div>/gi;
      const auraFixedBefore = (html.match(auraFixedContainerPattern) || []).length;
      html = html.replace(auraFixedContainerPattern, '');
      if (auraFixedBefore > 0) {
        badgesRemoved += auraFixedBefore;
        console.log(`   🗑️  Removidos ${auraFixedBefore} containers fixos do Aura`);
      }

      // 🔄 FALLBACK: Remover links genéricos com "lovable.app", "v0.dev" ou "aura.build"
      const linkPattern = /<a[^>]*(?:href=["'][^"']*(?:lovable\.app|v0\.dev|lovable\.dev|aura\.build)[^"']*["'])[^>]*>(?:(?!<\/a>)[\s\S])*?<\/a>/gi;
      const linksBefore = (html.match(linkPattern) || []).length;
      html = html.replace(linkPattern, '');
      if (linksBefore > 0) {
        badgesRemoved += linksBefore;
        console.log(`   🗑️  Removidos ${linksBefore} links genéricos (lovable/v0/aura)`);
      }

      // 🔄 FALLBACK: Remover elementos com classes comuns de badges
      const badgePattern = /<(?:div|a)[^>]*(?:class|id)=["'][^"']*(?:badge|branding|watermark|footer-badge|made-with)[^"']*["'][^>]*>(?:(?!<\/(?:div|a)>)[\s\S])*?(?:Made with|Built with|Powered by)(?:(?!<\/(?:div|a)>)[\s\S])*?<\/(?:div|a)>/gi;
      const badgesBefore = (html.match(badgePattern) || []).length;
      html = html.replace(badgePattern, '');
      if (badgesBefore > 0) {
        badgesRemoved += badgesBefore;
        console.log(`   🗑️  Removidos ${badgesBefore} badges genéricos (classes)`);
      }

      if (badgesRemoved > 0) {
        console.log(`   ✅ Total de ${badgesRemoved} badges de branding removidos`);
      } else {
        console.log('   ℹ️  Nenhum badge encontrado');
      }

      // 🎯 CRITICAL: Remover APENAS scripts específicos do Next.js que causam "Connection closed"
      // IMPORTANTE: O conteúdo JÁ está renderizado no DOM, então podemos remover scripts com segurança
      console.log('🧹 [Puppeteer] Removendo scripts problemáticos do Next.js...');

      // ✅ Remover APENAS scripts webpack que tentam reconectar ao servidor
      const webpackScriptsBefore = (html.match(/<script\s+[^>]*src\s*=\s*["'][^"']*\/_next\/static\/chunks\/webpack[^"']*["'][^>]*>\s*<\/script>/gi) || []).length;
      html = html.replace(/<script\s+[^>]*src\s*=\s*["'][^"']*\/_next\/static\/chunks\/webpack[^"']*["'][^>]*>\s*<\/script>/gi, '');
      if (webpackScriptsBefore > 0) {
        console.log(`   🗑️  Removidos ${webpackScriptsBefore} scripts webpack`);
      }

      // ✅ Remover scripts inline que causam erro de streaming
      const streamScriptsBefore = (html.match(/<script[^>]*>[\s\S]*?createFromReadableStream[\s\S]*?<\/script>/gi) || []).length;
      html = html.replace(/<script[^>]*>[\s\S]*?createFromReadableStream[\s\S]*?<\/script>/gi, '');
      if (streamScriptsBefore > 0) {
        console.log(`   🗑️  Removidos ${streamScriptsBefore} scripts com createFromReadableStream`);
      }

      // ✅ Converter __NEXT_DATA__ para JSON inativo (sem executar)
      // Isso é seguro porque o conteúdo JÁ foi renderizado no HTML
      html = html.replace(/<script[^>]*>[\s\S]*?__NEXT_DATA__[\s\S]*?<\/script>/gi, (match) => {
        return match.replace('<script', '<script type="application/json"');
      });
      console.log('   ✅ __NEXT_DATA__ convertido para JSON inativo');

      // 🔧 ADICIONAL: Remover scripts /_next/ externos que causam erros (framework chunks)
      // Manter APENAS scripts inline ou data: que podem ter estilos críticos
      const nextChunksBefore = (html.match(/<script\s+[^>]*src\s*=\s*["'][^"']*\/_next\/static\/chunks\/[^"']*["'][^>]*>\s*<\/script>/gi) || []).length;
      html = html.replace(/<script\s+[^>]*src\s*=\s*["'][^"']*\/_next\/static\/chunks\/(?!polyfills)[^"']*["'][^>]*>\s*<\/script>/gi, '');
      if (nextChunksBefore > 0) {
        console.log(`   🗑️  Removidos ${nextChunksBefore} scripts de chunks Next.js (conteúdo já está no DOM)`);
      }

      console.log('✅ [Puppeteer] Scripts problemáticos removidos (conteúdo preservado no HTML)');

      // 7️⃣ Processar HTML (mesma lógica do método normal)
      const originalHtml = html;
      const stats = this.getCleaningStats();

      html = this.trackingCleaner.cleanTrackingCodes(html, stats);

      const validation = this.trackingCleaner.validatePreservation(originalHtml, html);
      if (validation.warnings.length > 0) {
        console.warn('⚠️ AVISOS DE VALIDAÇÃO:');
        validation.warnings.forEach(warning => console.warn(warning));
      } else {
        console.log('✅ VALIDAÇÃO: CSS, JavaScript e imagens preservados com sucesso!');
      }

      html = this.disableNextJsRSC(html);
      html = this.convertRelativeUrls(html, url);
      html = this.disableWPRocket(html);

      // 🔓 CRITICAL para Lovable: Remover CSP que pode bloquear scripts inline
      if (url.includes('lovable') || html.includes('lovable')) {
        console.log('🔓 [Puppeteer] Removendo Content-Security-Policy para permitir injeção de scripts...');
        html = this.removeCSP(html);
      }

      html = this.processHtml(html, url, options);

      console.log('✅ [Puppeteer] Clonagem com navegador concluída com sucesso!');

      return { html, stats };
    } catch (error: any) {
      if (browser) {
        await browser.close();
      }
      console.error('❌ [Puppeteer] Erro:', error.message);
      throw new HttpException(
        `Erro ao clonar com Puppeteer: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * 🧹 LIMPEZA 1: Remover Meta Pixels e Tracking
   */
  private removeTrackingCodes(html: string, stats: CleaningStats): string {
    // Remover Meta Pixel
    html = html.replace(
      /<!-- Meta Pixel Code -->[\s\S]*?<!-- End Meta Pixel Code -->/gi,
      ''
    );
    html = html.replace(
      /fbq\(['"](init|track)['"]\s*,[\s\S]*?\);/gi,
      (match) => {
        stats.metaPixels++;
        return '';
      }
    );

    // Remover Google Analytics
    html = html.replace(
      /<!-- Google Analytics -->[\s\S]*?<!-- End Google Analytics -->/gi,
      ''
    );
    html = html.replace(
      /<!-- Google tag \(gtag.js\) -->[\s\S]*?<!-- End Google tag -->/gi,
      ''
    );
    html = html.replace(
      /gtag\(['"](config|event)['"]\s*,[\s\S]*?\);/gi,
      (match) => {
        stats.analyticsScripts++;
        return '';
      }
    );

    // Remover Microsoft Clarity
    html = html.replace(
      /<!-- Microsoft Clarity -->[\s\S]*?<!-- End Microsoft Clarity -->/gi,
      ''
    );

    // Remover scripts inline de tracking
    html = html.replace(
      /<script[^>]*>\s*window\.dataLayer[\s\S]*?<\/script>/gi,
      (match) => {
        stats.analyticsScripts++;
        return '';
      }
    );

    // Remover scripts de UTMFY e similares
    html = html.replace(
      /<script[^>]*src=["'].*?(tracker|analytics|pixel|conversion).*?["'][^>]*><\/script>/gi,
      (match) => {
        stats.trackingScripts++;
        return '';
      }
    );

    return html;
  }

  /**
   * 🏷️ LIMPEZA 2: Remover Meta Tags de Tracking
   */
  private removeTrackingMetaTags(html: string, stats: CleaningStats): string {
    console.log(
      '🏷️ [removeTrackingMetaTags] Removendo meta tags de tracking...'
    );
    let removedCount = 0;

    // Facebook Domain Verification
    html = html.replace(
      /<meta\s+name=["']facebook-domain-verification["']\s+content=["'][^"']*["'][^>]*>/gi,
      (match) => {
        console.log('🗑️ Removido: Facebook Domain Verification');
        removedCount++;
        return '';
      }
    );

    // Google Site Verification
    html = html.replace(
      /<meta\s+name=["']google-site-verification["']\s+content=["'][^"']*["'][^>]*>/gi,
      (match) => {
        console.log('🗑️ Removido: Google Site Verification');
        removedCount++;
        return '';
      }
    );

    // Facebook App ID
    html = html.replace(
      /<meta\s+property=["']fb:app_id["']\s+content=["'][^"']*["'][^>]*>/gi,
      (match) => {
        console.log('🗑️ Removido: Facebook App ID');
        removedCount++;
        return '';
      }
    );

    // Microsoft Clarity Project ID (meta tag)
    html = html.replace(
      /<meta\s+name=["']msapplication-TileImage["']\s+content=["'][^"']*clarity[^"']*["'][^>]*>/gi,
      (match) => {
        console.log('🗑️ Removido: Microsoft Clarity meta tag');
        removedCount++;
        return '';
      }
    );

    stats.trackingScripts += removedCount;
    console.log(
      `✅ [removeTrackingMetaTags] ${removedCount} meta tags removidas`
    );
    return html;
  }

  /**
   * 🧩 LIMPEZA 3: Remover Containers/Helpers de Pixels
   */
  private removePixelHelpers(html: string, stats: CleaningStats): string {
    console.log(
      '🧩 [removePixelHelpers] Removendo containers auxiliares de pixels...'
    );
    let removedCount = 0;

    // PixelYourSite containers
    html = html.replace(
      /<div[^>]*id=["']pys[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
      (match) => {
        console.log('🗑️ Removido: Container PixelYourSite');
        removedCount++;
        return '';
      }
    );

    // PixelYourSite scripts inline
    html = html.replace(
      /<script[^>]*id=["']pys[^"']*["'][^>]*>[\s\S]*?<\/script>/gi,
      (match) => {
        console.log('🗑️ Removido: Script PixelYourSite');
        removedCount++;
        return '';
      }
    );

    // WooCommerce Order Attribution (inputs hidden de tracking)
    html = html.replace(
      /<input[^>]*name=["']wc[-_]order[-_]attribution[^"']*["'][^>]*>/gi,
      (match) => {
        console.log('🗑️ Removido: WooCommerce Order Attribution input');
        removedCount++;
        return '';
      }
    );

    // Sourcebuster cookies (tracking de origem de tráfego)
    html = html.replace(
      /<script[^>]*>[\s\S]*?sbjs[\s\S]*?<\/script>/gi,
      (match) => {
        // Não remover se for parte de funcionalidade essencial
        if (match.includes('elementor') || match.includes('jquery')) {
          return match;
        }
        console.log('🗑️ Removido: Sourcebuster script');
        removedCount++;
        return '';
      }
    );

    stats.trackingScripts += removedCount;
    console.log(`✅ [removePixelHelpers] ${removedCount} helpers removidos`);
    return html;
  }

  /**
   * 🌐 CONVERSÃO: Converter URLs relativas para absolutas
   */
  private convertRelativeUrls(html: string, baseUrl: string): string {
    const baseObj = new URL(baseUrl);
    const baseOrigin = baseObj.origin;

    // Adicionar base tag se não existir
    if (!html.includes('<base')) {
      html = html.replace(/<head[^>]*>/i, `<head>\n<base href="${baseUrl}">`);
    }

    // Converter hrefs
    html = html.replace(/href=["'](\/[^"']*?)["']/g, (match, url) => {
      if (!url.startsWith('http')) {
        return `href="${baseOrigin}${url}"`;
      }
      return match;
    });

    // Converter srcs
    html = html.replace(/src=["'](\/[^"']*?)["']/g, (match, url) => {
      if (!url.startsWith('http')) {
        return `src="${baseOrigin}${url}"`;
      }
      return match;
    });

    // Converter data-src (lazy loading)
    html = html.replace(/data-src=["'](\/[^"']*?)["']/g, (match, url) => {
      if (!url.startsWith('http')) {
        return `data-src="${baseOrigin}${url}"`;
      }
      return match;
    });

    return html;
  }

  /**
   * 🚀 DESATIVAR: WP Rocket lazy loading e garantir jQuery
   * Converte scripts lazy do WP Rocket para scripts normais e injeta jQuery
   */
  /**
   * 🔓 REMOVER CSP (Content Security Policy)
   * Sites como Lovable podem ter CSP que bloqueia scripts inline injetados
   */
  private removeCSP(html: string): string {
    let modified = html;

    // Remover meta tags de CSP
    const cspMetaRegex = /<meta[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/gi;
    const cspMetaBefore = (html.match(cspMetaRegex) || []).length;
    modified = modified.replace(cspMetaRegex, '');
    if (cspMetaBefore > 0) {
      console.log(`   🗑️  Removidas ${cspMetaBefore} meta tags CSP`);
    }

    // Remover meta tags de CSP Report Only
    const cspReportRegex = /<meta[^>]*http-equiv\s*=\s*["']Content-Security-Policy-Report-Only["'][^>]*>/gi;
    const cspReportBefore = (html.match(cspReportRegex) || []).length;
    modified = modified.replace(cspReportRegex, '');
    if (cspReportBefore > 0) {
      console.log(`   🗑️  Removidas ${cspReportBefore} meta tags CSP Report-Only`);
    }

    const totalRemoved = cspMetaBefore + cspReportBefore;
    if (totalRemoved > 0) {
      console.log(`✅ [removeCSP] Total de ${totalRemoved} políticas CSP removidas`);
    } else {
      console.log('ℹ️  [removeCSP] Nenhuma política CSP encontrada (isso é normal)');
    }

    return modified;
  }

  /**
   * 🎬 Remove autoplay de vídeos do YouTube durante clonagem/edição
   * Evita que vídeos reproduzam automaticamente enquanto o usuário está editando
   */
  private disableYouTubeAutoplay(html: string): string {
    console.log('🎬 [disableYouTubeAutoplay] Removendo autoplay de vídeos do YouTube...');

    let modifiedCount = 0;

    // 1. Remover autoplay=1 das URLs de embed do YouTube
    html = html.replace(
      /(<iframe[^>]*src=["']https?:\/\/(?:www\.)?(?:youtube\.com\/embed|youtube-nocookie\.com\/embed)[^"']*)(autoplay=1)([^"']*["'][^>]*>)/gi,
      (match, before, autoplay, after) => {
        modifiedCount++;
        // Remover autoplay=1 e o & ou ? antes/depois
        let cleaned = before;
        if (cleaned.endsWith('&')) {
          cleaned = cleaned.slice(0, -1);
        } else if (cleaned.endsWith('?')) {
          // Se autoplay era o único parâmetro, manter o ?
          if (after.startsWith('&')) {
            after = '?' + after.substring(1);
          }
        }
        return cleaned + after;
      }
    );

    // 2. Remover o atributo allow="autoplay" dos iframes do YouTube
    html = html.replace(
      /(<iframe[^>]*src=["'][^"']*(?:youtube\.com|youtube-nocookie\.com)[^"']*["'][^>]*)\s+allow=["']([^"']*)autoplay;?([^"']*)["']/gi,
      (match, before, allowBefore, allowAfter) => {
        modifiedCount++;
        // Reconstruir o allow sem autoplay
        let newAllow = (allowBefore + ' ' + allowAfter).trim().replace(/\s+/g, ' ');
        // Remover ponto e vírgula extra
        newAllow = newAllow.replace(/;\s*;/g, ';').replace(/^;|;$/g, '');

        if (newAllow) {
          return `${before} allow="${newAllow}"`;
        } else {
          return before; // Se allow ficou vazio, remover completamente
        }
      }
    );

    if (modifiedCount > 0) {
      console.log(`   ✅ ${modifiedCount} vídeos do YouTube com autoplay desativado`);
    } else {
      console.log('   ℹ️  Nenhum autoplay do YouTube encontrado');
    }

    return html;
  }

  private disableWPRocket(html: string): string {
    console.log('🚀 [disableWPRocket] Desativando WP Rocket lazy loading...');

    let modifiedCount = 0;

    // 1. Converter type="rocketlazyloadscript" para type="text/javascript"
    const beforeRocketType = html.length;
    html = html.replace(/type=["']rocketlazyloadscript["']/gi, (match) => {
      modifiedCount++;
      return 'type="text/javascript"';
    });
    console.log(
      `   - Convertidos ${modifiedCount} scripts rocketlazyloadscript`
    );

    // 2. Converter data-rocket-src para src
    let srcCount = 0;
    html = html.replace(/data-rocket-src=/gi, (match) => {
      srcCount++;
      return 'src=';
    });
    console.log(`   - Convertidos ${srcCount} atributos data-rocket-src`);

    // 3. Remover data-rocket-defer e data-rocket-async
    html = html.replace(/\s+data-rocket-defer/gi, '');
    html = html.replace(/\s+data-rocket-async/gi, '');

    // 4. Remover outros atributos do WP Rocket
    html = html.replace(/\s+data-rocket-type=["'][^"']*["']/gi, '');
    html = html.replace(/\s+data-minify=["'][^"']*["']/gi, '');

    // 5. CRÍTICO: Garantir que jQuery está carregado ANTES de outros scripts
    // Verificar se jQuery já está no HTML
    const hasjQuery = html.includes('jquery') || html.includes('jQuery');
    console.log(`   - jQuery encontrado no HTML: ${hasjQuery}`);

    // 5.1. Verificar e injetar jQuery UI (necessário para Elementor)
    const hasjQueryUI = html.includes('jquery-ui') || html.includes('jqueryui');
    console.log(`   - jQuery UI encontrado no HTML: ${hasjQueryUI}`);

    // ✅ FIX: Injetar jQuery e jQuery UI em uma ÚNICA operação para garantir ordem correta
    if (!hasjQuery || !hasjQueryUI) {
      console.log(`   - ⚠️ Injetando scripts jQuery (jQuery: ${!hasjQuery}, jQuery UI: ${!hasjQueryUI})...`);

      let scriptsToInject = '';

      // Primeiro: jQuery (se necessário)
      if (!hasjQuery) {
        scriptsToInject += `\n<script src="https://code.jquery.com/jquery-3.7.1.min.js" integrity="sha256-/JqT3SQfawRcv/BIHPThkBvs0OEvtFFmqPF/lYI/Cxo=" crossorigin="anonymous"></script>`;
      }

      // Segundo: jQuery UI (se necessário) - SEMPRE após jQuery
      if (!hasjQueryUI) {
        scriptsToInject += `\n<script src="https://code.jquery.com/ui/1.13.2/jquery-ui.min.js" integrity="sha256-lSjKY0/srUM9BE3dPm+c4fBo1dky2v27Gdjm2uoZaL0=" crossorigin="anonymous"></script>\n<link rel="stylesheet" href="https://code.jquery.com/ui/1.13.2/themes/base/jquery-ui.css">`;
      }

      // Injetar tudo de uma vez (garante ordem correta)
      html = html.replace(
        /<head[^>]*>/i,
        `<head>${scriptsToInject}`
      );
    }

    // 6. Garantir que scripts do Elementor executem APÓS jQuery
    // Mover todos os scripts jQuery para o topo do head
    const jqueryScriptRegex =
      /<script[^>]*src=["'][^"']*jquery[^"']*["'][^>]*>[\s\S]*?<\/script>/gi;
    const jqueryScripts: string[] = [];

    html = html.replace(jqueryScriptRegex, (match) => {
      jqueryScripts.push(match);
      return ''; // Remover do local atual
    });

    if (jqueryScripts.length > 0) {
      console.log(
        `   - Movendo ${jqueryScripts.length} scripts jQuery para o início do head`
      );
      html = html.replace(
        /<head[^>]*>/i,
        `<head>\n${jqueryScripts.join('\n')}`
      );
    }

    console.log('✅ [disableWPRocket] WP Rocket desativado e jQuery garantido');
    return html;
  }

  /**
   * 🚀 Desabilitar React Server Components do Next.js
   * Remove scripts que tentam fazer streaming/hydration e causam erro "Connection closed"
   */
  private disableNextJsRSC(html: string): string {
    console.log('🚀 [disableNextJsRSC] Neutralizando problemas do Next.js RSC...');

    // ✅ NOVA ESTRATÉGIA: Em vez de REMOVER scripts (que quebra o conteúdo),
    // vamos INTERCEPTAR erros e fazer MOCK das funções problemáticas
    // Isso permite que o JavaScript execute normalmente, mas sem tentar
    // se comunicar com o servidor original

    // 1️⃣ Detectar se é um site Next.js
    const isNextJs = html.includes('__NEXT_DATA__') || html.includes('/_next/');

    if (!isNextJs) {
      console.log('   - Não é um site Next.js, pulando neutralização');
      return html;
    }

    console.log('   - ✅ Site Next.js detectado, aplicando neutralização inteligente');

    // 2️⃣ Injetar script de interceptação ANTES de qualquer script do Next.js
    const isProduction = process.env.NODE_ENV === 'production';
    const neutralizationScript = `
<script>
(function() {
  'use strict';
  
  // 🔇 Sistema de logs condicionais: só loga em desenvolvimento
  var IS_PRODUCTION = ${isProduction};
  var debugLog = function() {
    if (!IS_PRODUCTION) {
      console.log.apply(console, arguments);
    }
  };
  
  debugLog('🛡️ [Next.js Neutralizer] Iniciando proteção contra erros de RSC...');

  // 1. Interceptar e silenciar erros "Connection closed"
  const originalConsoleError = console.error;
  console.error = function(...args) {
    const errorStr = args.join(' ');
    if (errorStr.includes('Connection closed') ||
        errorStr.includes('Failed to fetch RSC payload') ||
        errorStr.includes('RSC payload')) {
      debugLog('🛡️ [Next.js Neutralizer] Erro de RSC silenciado:', errorStr);
      return; // Silenciar o erro
    }
    originalConsoleError.apply(console, args);
  };

  // 2. Interceptar erros globais
  const originalOnError = window.onerror;
  window.onerror = function(message, source, lineno, colno, error) {
    const errorStr = String(message);
    if (errorStr.includes('Connection closed') ||
        errorStr.includes('Failed to fetch RSC payload')) {
      debugLog('🛡️ [Next.js Neutralizer] Erro global de RSC silenciado');
      return true; // Prevenir propagação
    }
    if (originalOnError) {
      return originalOnError(message, source, lineno, colno, error);
    }
    return false;
  };

  // 3. Interceptar promises rejeitadas
  window.addEventListener('unhandledrejection', function(event) {
    const reason = String(event.reason);
    if (reason.includes('Connection closed') ||
        reason.includes('Failed to fetch RSC payload')) {
      debugLog('🛡️ [Next.js Neutralizer] Promise rejection de RSC silenciada');
      event.preventDefault();
    }
  });

  // 4. Fazer mock de fetch para URLs do Next.js RSC
  const originalFetch = window.fetch;
  window.fetch = function(url, options) {
    const urlStr = String(url);

    // Detectar requests do Next.js RSC (geralmente têm _rsc no query string)
    if (urlStr.includes('_rsc=') || urlStr.includes('/_next/data/')) {
      debugLog('🛡️ [Next.js Neutralizer] Bloqueando fetch RSC para:', urlStr);
      // Retornar uma Promise que resolve com resposta vazia mas válida
      return Promise.resolve(new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    // Para outras URLs, usar fetch original
    return originalFetch.apply(this, arguments);
  };

  // 5. Modificar __NEXT_DATA__ para desabilitar features problemáticas
  if (window.__NEXT_DATA__) {
    // Desabilitar prefetching que pode causar erros
    if (window.__NEXT_DATA__.props) {
      window.__NEXT_DATA__.props.pageProps = window.__NEXT_DATA__.props.pageProps || {};
    }
    // Marcar como fallback para desabilitar certas otimizações
    window.__NEXT_DATA__.isFallback = false; // false é melhor que true aqui
    window.__NEXT_DATA__.gssp = true; // Fingir que é getServerSideProps
  }

  debugLog('✅ [Next.js Neutralizer] Proteção ativada com sucesso!');
})();
</script>`;

    // 3️⃣ Injetar o script logo após a tag <head>
    html = html.replace(/<head[^>]*>/i, (match) => `${match}\n${neutralizationScript}`);

    console.log('   - ✅ Script de neutralização injetado');
    console.log('   - ✅ Erros de RSC serão interceptados e silenciados');
    console.log('   - ✅ Conteúdo da página preservado completamente');

    console.log('✅ [disableNextJsRSC] Neutralização do Next.js RSC concluída');
    return html;
  }

  /**
   * 🔗 REMOVER: Scripts externos perigosos (mas preservar jQuery, Elementor, etc)
   */
  /**
   * 🔗 LIMPEZA 4: Remover Scripts Externos de Tracking (100+ domínios)
   */
  private removeExternalScripts(html: string, stats: CleaningStats): string {
    console.log(
      '🔗 [removeExternalScripts] Removendo scripts externos de 100+ domínios de tracking...'
    );

    // Lista EXPANDIDA com 100+ domínios de tracking conhecidos
    const trackingDomains = [
      // === FACEBOOK / META ===
      'facebook.com',
      'facebook.net',
      'connect.facebook.net',
      'fb.com',
      'fbcdn.net',

      // === GOOGLE ===
      'google-analytics.com',
      'analytics.google.com',
      'googletagmanager.com',
      'googletagservices.com',
      'googleads.g.doubleclick.net',
      'doubleclick.net',
      'stats.g.doubleclick.net',
      'googlesyndication.com',
      'googleadservices.com',
      'google.com/recaptcha',
      'gstatic.com/recaptcha',

      // === MICROSOFT ===
      'clarity.ms',
      'bat.bing.com',
      'bing.com/merchant',

      // === ANALYTICS PLATFORMS ===
      'hotjar.com',
      'static.hotjar.com',
      'segment.com',
      'segment.io',
      'cdn.segment.com',
      'mixpanel.com',
      'amplitude.com',
      'heap.io',
      'heapanalytics.com',
      'fullstory.com',
      'mouseflow.com',
      'crazyegg.com',
      'inspectlet.com',
      'luckyorange.com',
      'quantserve.com',
      'scorecardresearch.com',

      // === SOCIAL MEDIA PIXELS ===
      'pinterest.com',
      'ct.pinterest.com',
      'pinimg.com',
      'linkedin.com',
      'snap.licdn.com',
      'ads-twitter.com',
      'analytics.twitter.com',
      'static.ads-twitter.com',
      'tiktok.com',
      'analytics.tiktok.com',
      'reddit.com',
      'alb.reddit.com',
      'quora.com',
      'qth.quoracdn.net',

      // === AD NETWORKS ===
      'taboola.com',
      'cdn.taboola.com',
      'outbrain.com',
      'widgets.outbrain.com',
      'adroll.com',
      'criteo.com',
      'criteo.net',
      'advertising.com',
      'media.net',
      'pubmatic.com',
      'rubiconproject.com',
      'openx.net',
      'indexww.com',
      'contextweb.com',

      // === E-COMMERCE TRACKING ===
      'shopify.com',
      'myshopify.com',
      'cdn.shopify.com',

      // === CHAT / SUPPORT ===
      'intercom.io',
      'intercom.com',
      'drift.com',
      'drift.net',
      'driftt.com',
      'crisp.chat',
      'client.crisp.chat',
      'tidio.co',
      'code.tidio.co',
      'tawk.to',
      'embed.tawk.to',
      'zendesk.com',
      'static.zdassets.com',
      'freshchat.com',
      'wchat.freshchat.com',
      'livechatinc.com',
      'cdn.livechatinc.com',

      // === MARKETING AUTOMATION ===
      'hubspot.com',
      'js.hs-scripts.com',
      'js.hs-analytics.net',
      'mailchimp.com',
      'list-manage.com',
      'activecampaign.com',
      'trackcmp.net',
      'getresponse.com',
      'klaviyo.com',
      'static.klaviyo.com',

      // === MONITORING / ERROR TRACKING ===
      'sentry.io',
      'browser.sentry-cdn.com',
      'bugsnag.com',
      'd2wy8f7a9ursnm.cloudfront.net',
      'rollbar.com',
      'cdnjs.rollbar.com',
      'logrocket.com',
      'cdn.lr-ingest.io',
      'newrelic.com',
      'js-agent.newrelic.com',
      'nr-data.net',
      'bam.nr-data.net',

      // === OPTIMIZATION & A/B TESTING ===
      'optimizely.com',
      'cdn.optimizely.com',
      'vwo.com',
      'dev.visualwebsiteoptimizer.com',
      'googleoptimize.com',

      // === WEBHOOKS / AUTOMATION ===
      'zapier.com',
      'hooks.zapier.com',
      'n8n.io',
      'pipedream.com',
      'integromat.com',
      'make.com',
      'webhook.site',
      'ifttt.com',

      // === UTM & URL TRACKING ===
      'utmfy.com',
      'utmz.com',
      'bit.ly',
      'ow.ly',
      'goo.gl',

      // === AFFILIATE TRACKING ===
      'awin1.com',
      'avantlink.com',
      'dpbolvw.net',
      'anrdoezrs.net',
      'jdoqocy.com',
      'kqzyfj.com',
      'tkqlhce.com',
      'cj.com',
      'emjcd.com',
      'evyy.net',
    ];

    let removedCount = 0;

    for (const domain of trackingDomains) {
      const regex = new RegExp(
        `<script[^>]*src=["'][^"']*${domain.replace(
          /\./g,
          '\\.'
        )}[^"']*["'][^>]*>.*?<\\/script>`,
        'gi'
      );
      html = html.replace(regex, (match) => {
        console.log(`🗑️ Removido script externo de: ${domain}`);
        stats.trackingScripts++;
        removedCount++;
        return '';
      });
    }

    console.log(
      `✅ [removeExternalScripts] ${removedCount} scripts externos de tracking removidos de ${trackingDomains.length} domínios verificados`
    );

    // Remover inline scripts que fazem fetch para webhooks
    // MAS: Preservar scripts que são do Elementor, jQuery, ou outros frameworks legítimos
    html = html.replace(
      /<script[^>]*>[\s\S]*?(webhook|fetch|XMLHttpRequest)[\s\S]*?<\/script>/gi,
      (match) => {
        // IMPORTANTE: NÃO remover se for script do Elementor ou jQuery
        if (
          match.includes('elementor') ||
          match.includes('jquery') ||
          match.includes('jQuery')
        ) {
          return match; // Manter
        }

        // Remover APENAS se for webhook explícito
        if (
          match.includes('webhook') ||
          match.includes('https://hook.') ||
          match.includes('https://api.')
        ) {
          stats.webhooks++;
          return '';
        }

        return match; // Manter outros scripts com fetch/XMLHttpRequest
      }
    );

    return html;
  }

  /**
   * 🔗 LIMPEZA 5: Remover Tags <link> de Preconnect/DNS-Prefetch para Domínios de Tracking
   * ⚠️ ULTRA CONSERVADOR: Remove APENAS links que são 100% claramente de tracking e não afetam funcionalidade
   * IMPORTANTE: Preserva TODOS os links que possam ser necessários para o funcionamento do site
   */
  private removeTrackingLinks(html: string, stats: CleaningStats): string {
    console.log(
      '🔗 [removeTrackingLinks] Removendo tags <link> de tracking (modo ultra conservador)...'
    );

    // Lista MUITO REDUZIDA: apenas domínios de tracking que NUNCA são usados para recursos essenciais
    const strictTrackingDomains = [
      'connect.facebook.net', // Facebook Pixel
      'analytics.google.com', // Google Analytics
      'www.googletagmanager.com', // Google Tag Manager
      'google-analytics.com', // Google Analytics antigo
      'clarity.ms', // Microsoft Clarity
      'cdn.utmify.com.br', // UTMFY tracking
    ];

    let removedCount = 0;

    for (const domain of strictTrackingDomains) {
      const domainPattern = domain.replace(/\./g, '\\.');

      // Remover APENAS tags <link> com data-rocket-preconnect (WP Rocket otimização)
      // que apontam para domínios de tracking ESTRITOS
      // Isso é seguro porque são apenas otimizações, não recursos essenciais
      const rocketPreconnectRegex = new RegExp(
        `<link[^>]*data-rocket-preconnect[^>]*href=["'][^"']*${domainPattern}[^"']*["'][^>]*>`,
        'gi'
      );
      html = html.replace(rocketPreconnectRegex, (match) => {
        console.log(`🗑️ Removido data-rocket-preconnect para: ${domain}`);
        stats.trackingScripts++;
        removedCount++;
        return '';
      });

      // Remover links rel="dns-prefetch" APENAS se não tiverem atributos do WordPress/Elementor
      // e forem APENAS para domínios de tracking estritos
      const dnsPrefetchRegex = new RegExp(
        `<link[^>]*rel=["']dns-prefetch["'][^>]*href=["'][^"']*${domainPattern}[^"']*["'][^>]*>`,
        'gi'
      );
      html = html.replace(dnsPrefetchRegex, (match) => {
        // Preservar SEMPRE se tiver qualquer atributo do WordPress/Elementor/WP Rocket
        if (
          match.includes('data-rocket') ||
          match.includes('wp-content') ||
          match.includes('elementor')
        ) {
          return match;
        }

        // Remover apenas se for claramente um link isolado de tracking
        console.log(`🗑️ Removido dns-prefetch para: ${domain}`);
        stats.trackingScripts++;
        removedCount++;
        return '';
      });
    }

    // NÃO remover links rel="preconnect" pois podem ser necessários para recursos
    // Mesmo que apontem para domínios de tracking, podem estar sendo usados para outras coisas
    // O importante é remover os scripts de tracking em si, não as otimizações de conexão

    console.log(
      `✅ [removeTrackingLinks] ${removedCount} tags <link> de tracking removidas (modo ultra conservador - preservando funcionalidade)`
    );
    return html;
  }

  /**
   * 🛡️ LIMPEZA 5.5: Remover Scripts Maliciosos (Redirecionamentos, Proteção Anti-Clone, etc.)
   * Esta função remove scripts que tentam:
   * - Redirecionar para outras páginas
   * - Detectar clonagem/iframe
   * - Bloquear inspeção/devtools
   * - Exibir popups/alerts
   */
  private removeMaliciousScripts(html: string, stats: CleaningStats): string {
    console.log(
      '🛡️ [removeMaliciousScripts] Removendo scripts maliciosos e de proteção...'
    );

    let removedCount = 0;

    // Padrões de scripts maliciosos para remover
    const maliciousPatterns = [
      // === REDIRECIONAMENTOS ===
      // window.location = "..."
      /<script[^>]*>[\s\S]*?window\.location\s*=\s*["'][^"']+["'][\s\S]*?<\/script>/gi,
      // window.location.href = "..."
      /<script[^>]*>[\s\S]*?window\.location\.href\s*=\s*["'][^"']+["'][\s\S]*?<\/script>/gi,
      // location.replace("...")
      /<script[^>]*>[\s\S]*?location\.replace\s*\([\s\S]*?\)[\s\S]*?<\/script>/gi,
      // location.assign("...")
      /<script[^>]*>[\s\S]*?location\.assign\s*\([\s\S]*?\)[\s\S]*?<\/script>/gi,
      // document.location = "..."
      /<script[^>]*>[\s\S]*?document\.location\s*=[\s\S]*?<\/script>/gi,
      // top.location (iframe breaker)
      /<script[^>]*>[\s\S]*?top\.location[\s\S]*?<\/script>/gi,
      // parent.location (iframe breaker)
      /<script[^>]*>[\s\S]*?parent\.location[\s\S]*?<\/script>/gi,

      // === DETECÇÃO DE IFRAME/CLONAGEM ===
      // self !== top
      /<script[^>]*>[\s\S]*?self\s*!==?\s*top[\s\S]*?<\/script>/gi,
      // window.frameElement
      /<script[^>]*>[\s\S]*?window\.frameElement[\s\S]*?<\/script>/gi,
      // inIframe detection
      /<script[^>]*>[\s\S]*?inIframe[\s\S]*?<\/script>/gi,

      // === ANTI-DEVTOOLS ===
      // debugger statements
      /<script[^>]*>[\s\S]*?\bdebugger\b[\s\S]*?<\/script>/gi,
      // devtools detection
      /<script[^>]*>[\s\S]*?devtools[\s\S]*?<\/script>/gi,

      // === ANTI-COPY/RIGHT-CLICK ===
      // oncontextmenu (right-click blocker)
      /<script[^>]*>[\s\S]*?oncontextmenu[\s\S]*?return\s*false[\s\S]*?<\/script>/gi,
      // onselectstart (selection blocker)
      /<script[^>]*>[\s\S]*?onselectstart[\s\S]*?return\s*false[\s\S]*?<\/script>/gi,
      // oncopy blocker
      /<script[^>]*>[\s\S]*?oncopy[\s\S]*?return\s*false[\s\S]*?<\/script>/gi,

      // === ALERTS/POPUPS MALICIOSOS ===
      // Alerts com textos suspeitos
      /<script[^>]*>[\s\S]*?alert\s*\([\s\S]*?(clonado|copiado|protegido|bloqueado|proibido)[\s\S]*?\)[\s\S]*?<\/script>/gi,

      // === TIMERS DE REDIRECIONAMENTO ===
      // setTimeout com redirect
      /<script[^>]*>[\s\S]*?setTimeout[\s\S]*?(location|redirect|window\.location)[\s\S]*?<\/script>/gi,
      // setInterval com redirect
      /<script[^>]*>[\s\S]*?setInterval[\s\S]*?(location|redirect)[\s\S]*?<\/script>/gi,

      // === META REFRESH (Redirecionamento via meta) ===
      /<meta[^>]*http-equiv=["']refresh["'][^>]*>/gi,
    ];

    // Remover cada padrão malicioso
    for (const pattern of maliciousPatterns) {
      html = html.replace(pattern, (match) => {
        // Verificar se não é um script legítimo (elementor, jquery, etc)
        const lowerMatch = match.toLowerCase();
        if (
          lowerMatch.includes('elementor') ||
          lowerMatch.includes('jquery') ||
          lowerMatch.includes('wp-content') ||
          lowerMatch.includes('data-tuglet')
        ) {
          return match; // Preservar scripts legítimos
        }

        console.log('🗑️ Removido script malicioso:', match.substring(0, 100) + '...');
        stats.trackingScripts++;
        removedCount++;
        return '';
      });
    }

    // Remover atributos inline maliciosos do body e html
    html = html.replace(
      /<(body|html)[^>]*(onload|onunload|onbeforeunload)\s*=\s*["'][^"']*["'][^>]*>/gi,
      (match, tag) => {
        console.log(`🗑️ Removido atributo malicioso de <${tag}>`);
        removedCount++;
        // Remover apenas o atributo malicioso, manter a tag
        return match
          .replace(/\s*onload\s*=\s*["'][^"']*["']/gi, '')
          .replace(/\s*onunload\s*=\s*["'][^"']*["']/gi, '')
          .replace(/\s*onbeforeunload\s*=\s*["'][^"']*["']/gi, '');
      }
    );

    // Remover atributos que bloqueiam seleção/cópia do body
    html = html.replace(
      /<body[^>]*(oncontextmenu|onselectstart|oncopy|ondragstart)\s*=\s*["'][^"']*["'][^>]*>/gi,
      (match) => {
        console.log('🗑️ Removido bloqueio de interação do body');
        removedCount++;
        return match
          .replace(/\s*oncontextmenu\s*=\s*["'][^"']*["']/gi, '')
          .replace(/\s*onselectstart\s*=\s*["'][^"']*["']/gi, '')
          .replace(/\s*oncopy\s*=\s*["'][^"']*["']/gi, '')
          .replace(/\s*ondragstart\s*=\s*["'][^"']*["']/gi, '');
      }
    );

    console.log(
      `✅ [removeMaliciousScripts] ${removedCount} scripts/atributos maliciosos removidos`
    );
    return html;
  }

  /**
   * 🚀 LIMPEZA 5.6: Otimizações de Performance
   * - Garantir DOCTYPE correto
   * - Adicionar lazy loading em imagens
   * - Remover preloads desnecessários
   */
  private optimizePerformance(html: string): string {
    console.log('🚀 [optimizePerformance] Aplicando otimizações de performance...');

    let optimizations = 0;

    // 1. GARANTIR DOCTYPE CORRETO
    // Verificar se já tem DOCTYPE
    if (!html.trim().toLowerCase().startsWith('<!doctype')) {
      console.log('📄 [Performance] Adicionando DOCTYPE html');
      html = '<!DOCTYPE html>\n' + html;
      optimizations++;
    }

    // 2. LAZY LOADING EM IMAGENS (que não são above-the-fold)
    // Adicionar loading="lazy" em imagens que não têm o atributo
    html = html.replace(
      /<img(?![^>]*loading=)([^>]*)(src=["'][^"']+["'])([^>]*)>/gi,
      (match, before, src, after) => {
        // Não adicionar lazy em imagens que parecem ser acima da dobra
        const isHero = /hero|banner|logo|header|above|first/i.test(match);
        const hasEager = /loading=["']eager["']/i.test(match);

        if (isHero || hasEager) {
          return match; // Manter sem lazy
        }

        optimizations++;
        return `<img${before}${src} loading="lazy"${after}>`;
      }
    );

    // 3. ADICIONAR DECODING ASYNC EM IMAGENS
    html = html.replace(
      /<img(?![^>]*decoding=)([^>]*src=["'][^"']+["'][^>]*)>/gi,
      (match, attrs) => {
        optimizations++;
        return `<img${attrs} decoding="async">`;
      }
    );

    // 4. REMOVER PRELOADS DE RECURSOS DE TRACKING
    const trackingPreloads = [
      'facebook.net',
      'googletagmanager.com',
      'google-analytics.com',
      'clarity.ms',
      'hotjar.com',
    ];

    for (const domain of trackingPreloads) {
      const preloadRegex = new RegExp(
        `<link[^>]*rel=["']preload["'][^>]*href=["'][^"']*${domain.replace(/\./g, '\\.')}[^"']*["'][^>]*>`,
        'gi'
      );
      html = html.replace(preloadRegex, () => {
        console.log(`🗑️ [Performance] Removido preload de tracking: ${domain}`);
        optimizations++;
        return '';
      });
    }

    // 5. REMOVER SCRIPTS DE PERFORMANCE TRACKING (ex: web-vitals)
    html = html.replace(
      /<script[^>]*>([\s\S]*?)(web-vitals|performance\.mark|performance\.measure|sendBeacon)[\s\S]*?<\/script>/gi,
      (match) => {
        if (match.includes('data-tuglet') || match.includes('elementor')) {
          return match;
        }
        console.log('🗑️ [Performance] Removido script de performance tracking');
        optimizations++;
        return '';
      }
    );

    console.log(`✅ [optimizePerformance] ${optimizations} otimizações aplicadas`);
    return html;
  }

  /**
   * 📝 LIMPEZA 6: Remover Variáveis JavaScript e Configurações de Tracking
   * ⚠️ CONSERVADOR: Preserva scripts do Elementor/WordPress e apenas remove códigos explícitos de tracking
   */
  private removeTrackingConfigs(html: string, stats: CleaningStats): string {
    console.log(
      '📝 [removeTrackingConfigs] Removendo variáveis JavaScript e configurações de tracking (modo conservador)...'
    );

    let removedCount = 0;

    // Função auxiliar para verificar se um script deve ser preservado
    const shouldPreserve = (match: string): boolean => {
      // Preservar scripts marcados com data-tuglet (nossos códigos)
      if (match.includes('data-tuglet')) return true;

      // Preservar scripts do Elementor/WordPress
      const essentialKeywords = [
        'elementor',
        'jquery',
        'woocommerce',
        'wp-content',
        'wp-includes',
        'wordpress',
        'elementor-pro',
        'elementor-frontend',
        'wp-rocket',
        'wp-scripts',
      ];

      const lowerMatch = match.toLowerCase();
      for (const keyword of essentialKeywords) {
        if (lowerMatch.includes(keyword)) {
          return true;
        }
      }

      return false;
    };

    // Remover variável pysFacebookRest (PixelYourSite) - REMOVER APENAS A VARIÁVEL, preservando o script
    // Este script geralmente está em um bloco separado com id="jquery-core-js-extra"
    // Estratégia: tentar remover apenas a variável ou remover o script inteiro se for APENAS tracking
    const pysFacebookRegex =
      /<script[^>]*id=["']jquery-core-js-extra["'][^>]*>[\s\S]*?var\s+pysFacebookRest\s*=[\s\S]*?<\/script>/gi;
    html = html.replace(pysFacebookRegex, (match) => {
      // Verificar se o script contém APENAS a variável pysFacebookRest (script de tracking puro)
      const hasOnlyTracking =
        /var\s+pysFacebookRest\s*=/.test(match) &&
        !match.includes('jquery') &&
        !match.includes('elementor') &&
        match.trim().split(/var\s+pysFacebookRest/).length <= 2;

      if (hasOnlyTracking) {
        // Script contém APENAS tracking, remover completamente
        console.log(
          '🗑️ Removido: Script com apenas pysFacebookRest (PixelYourSite)'
        );
        stats.trackingScripts++;
        removedCount++;
        return '';
      }

      // Script contém outras coisas importantes, tentar remover apenas a variável pysFacebookRest
      // Remover a linha inteira: var pysFacebookRest = {...};
      const cleanedMatch = match.replace(
        /var\s+pysFacebookRest\s*=\s*\{[\s\S]*?\}[\s\S]*?;/gi,
        ''
      );
      if (cleanedMatch !== match && cleanedMatch.trim().length > 0) {
        console.log(
          '🗑️ Removido: Variável pysFacebookRest (preservando script essencial)'
        );
        stats.trackingScripts++;
        removedCount++;
        return cleanedMatch;
      }

      // Se não conseguir limpar sem quebrar, preservar o script completo
      console.log(
        '⚠️ Preservado: Script com pysFacebookRest (contém código essencial)'
      );
      return match;
    });

    // Também remover scripts isolados com pysFacebookRest (sem ID importante)
    const pysFacebookIsolatedRegex =
      /<script[^>]*>[\s\S]*?var\s+pysFacebookRest\s*=[\s\S]*?<\/script>/gi;
    html = html.replace(pysFacebookIsolatedRegex, (match) => {
      // Se já foi processado acima (tem id jquery-core-js-extra), pular
      if (match.includes('jquery-core-js-extra')) {
        return match;
      }

      // Verificar se deve preservar
      if (shouldPreserve(match)) {
        return match;
      }

      // Remover script isolado de tracking
      console.log('🗑️ Removido: Script isolado com pysFacebookRest');
      stats.trackingScripts++;
      removedCount++;
      return '';
    });

    // Remover scripts que definem window.pixelId e carregam pixels dinamicamente - APENAS se não for Elementor
    const dynamicPixelRegex =
      /<script[^>]*>[\s\S]*?window\.pixelId\s*=[\s\S]*?cdn\.utmify\.com\.br[\s\S]*?<\/script>/gi;
    html = html.replace(dynamicPixelRegex, (match) => {
      if (shouldPreserve(match)) {
        return match;
      }
      console.log(
        '🗑️ Removido: Script que define window.pixelId e carrega pixel dinamicamente'
      );
      stats.trackingScripts++;
      removedCount++;
      return '';
    });

    // Remover scripts UTMFY que carregam latest.js - APENAS se não for parte de script essencial
    const utmfyScriptRegex =
      /<script[^>]*src=["'][^"']*scripts\/utms\/latest\.js[^"']*["'][^>]*\s*><\/script>/gi;
    html = html.replace(utmfyScriptRegex, (match) => {
      if (shouldPreserve(match)) {
        return match;
      }
      console.log('🗑️ Removido: Script UTMFY latest.js');
      stats.trackingScripts++;
      removedCount++;
      return '';
    });

    // Remover scripts com atributos data-utmify-* - APENAS scripts de tracking
    const utmfyDataAttrExternalRegex =
      /<script[^>]*data-utmify-[^"']*src=["'][^"']*["'][^>]*\s*><\/script>/gi;
    html = html.replace(utmfyDataAttrExternalRegex, (match) => {
      if (shouldPreserve(match)) {
        return match;
      }
      console.log('🗑️ Removido: Script externo com atributos data-utmify-*');
      stats.trackingScripts++;
      removedCount++;
      return '';
    });

    // Remover scripts inline com atributos data-utmify-* - APENAS se não for essencial
    const utmfyDataAttrInlineRegex =
      /<script[^>]*data-utmify-[^>]*>[\s\S]*?<\/script>/gi;
    html = html.replace(utmfyDataAttrInlineRegex, (match) => {
      if (shouldPreserve(match)) {
        return match;
      }
      console.log('🗑️ Removido: Script inline com atributos data-utmify-*');
      stats.trackingScripts++;
      removedCount++;
      return '';
    });

    // Remover scripts que referenciam utmify/utmify.com.br - APENAS se for claramente tracking
    const utmfyRefRegex =
      /<script[^>]*>[\s\S]*?(utmify|utmz)\.com\.br[\s\S]*?<\/script>/gi;
    html = html.replace(utmfyRefRegex, (match) => {
      if (shouldPreserve(match)) {
        return match;
      }
      console.log('🗑️ Removido: Script que referencia utmify.com.br');
      stats.trackingScripts++;
      removedCount++;
      return '';
    });

    // Remover comentários sobre snippets de tracking (Google Tag, etc) - APENAS comentários isolados
    const snippetCommentRegex =
      /<!--\s*Snippet[^>]*Google[^>]*(gtag|Analytics|Anúncios)[^>]*-->/gi;
    html = html.replace(snippetCommentRegex, (match) => {
      console.log('🗑️ Removido: Comentário sobre snippet de tracking');
      stats.trackingScripts++;
      removedCount++;
      return '';
    });

    // Remover scripts que criam elementos dinamicamente para carregar pixels - APENAS se for claramente tracking
    const dynamicElementRegex =
      /<script[^>]*>[\s\S]*?createElement\s*\(["']script["']\)[\s\S]*?(cdn\.utmify\.com\.br|connect\.facebook\.net|googletagmanager\.com)[\s\S]*?<\/script>/gi;
    html = html.replace(dynamicElementRegex, (match) => {
      if (shouldPreserve(match)) {
        return match;
      }
      console.log(
        '🗑️ Removido: Script que cria elemento dinamicamente para tracking'
      );
      stats.trackingScripts++;
      removedCount++;
      return '';
    });

    console.log(
      `✅ [removeTrackingConfigs] ${removedCount} configurações de tracking removidas (preservando Elementor/WordPress)`
    );
    return html;
  }

  /**
   * ⚙️ PROCESSAR: Opções customizadas
   */
  private processHtml(
    html: string,
    baseUrl: string,
    options: ProcessOptions
  ): string {
    console.log(
      '🔧 [processHtml] ========== INICIANDO PROCESSAMENTO =========='
    );
    console.log('🔧 [processHtml] Options recebidas:', {
      injectCustom: options.injectCustom,
      pixelId: options.pixelId ? '***DEFINIDO***' : undefined,
      gtagId: options.gtagId ? '***DEFINIDO***' : undefined,
      whatsappNumber: options.whatsappNumber ? '***DEFINIDO***' : undefined,
      clarityId: options.clarityId ? '***DEFINIDO***' : undefined,
      utmfyCode: options.utmfyCode ? '***DEFINIDO***' : undefined,
      editMode: options.editMode,
    });

    // 🛡️ Injetar proteção contra location access cross-origin errors
    const protectionScript = this.getProtectionScript();
    html = html.replace(/<head[^>]*>/i, `<head>\n${protectionScript}`);

    // 🎬 Desativar autoplay de vídeos do YouTube (para não atrapalhar durante edição)
    html = this.disableYouTubeAutoplay(html);

    // Injetar custom codes se configurado
    console.log(
      '🔧 [processHtml] injectCustom:',
      options.injectCustom,
      'tipo:',
      typeof options.injectCustom
    );

    if (options.injectCustom) {
      console.log('✅ [processHtml] INJETANDO CÓDIGOS CUSTOMIZADOS');
      let injections = '';
      let injectionsCount = 0;

      // Meta Pixel
      if (options.pixelId) {
        console.log('✅ [processHtml] Injetando Meta Pixel:', options.pixelId);
        injections += this.getMetaPixelCode(options.pixelId);
        injectionsCount++;
      } else {
        console.log('⏭️ [processHtml] Meta Pixel não configurado');
      }

      // Google Tag
      if (options.gtagId) {
        console.log('✅ [processHtml] Injetando Google Tag:', options.gtagId);
        injections += this.getGoogleTagCode(options.gtagId);
        injectionsCount++;
      } else {
        console.log('⏭️ [processHtml] Google Tag não configurado');
      }

      // Microsoft Clarity
      if (options.clarityId) {
        console.log(
          '✅ [processHtml] Injetando Microsoft Clarity:',
          options.clarityId
        );
        injections += this.getMicrosoftClarityCode(options.clarityId);
        injectionsCount++;
      } else {
        console.log('⏭️ [processHtml] Microsoft Clarity não configurado');
      }

      // UTMFY
      if (options.utmfyCode) {
        console.log(
          '✅ [processHtml] Injetando UTMFY (tamanho:',
          options.utmfyCode.length,
          'chars)'
        );
        // Envolver o código UTMFY em script com data-tuglet para preservação
        injections += `<script data-tuglet="true" data-utmfy-wrapper="true">\n${options.utmfyCode}\n</script>`;
        injectionsCount++;
      } else {
        console.log('⏭️ [processHtml] UTMFY não configurado');
      }

      // WhatsApp Button
      if (options.whatsappNumber) {
        console.log(
          '✅ [processHtml] Injetando WhatsApp Button:',
          options.whatsappNumber
        );
        injections += this.getWhatsAppButtonCode(options.whatsappNumber);
        injectionsCount++;
      } else {
        console.log('⏭️ [processHtml] WhatsApp Button não configurado');
      }

      if (injections) {
        console.log(
          `🎯 [processHtml] Total de ${injectionsCount} códigos para injetar. Tamanho total: ${injections.length} chars`
        );
        const beforeReplace = html.length;
        html = html.replace(/<\/head>/i, `${injections}\n</head>`);
        const afterReplace = html.length;
        console.log(
          `✅ [processHtml] INJEÇÃO CONCLUÍDA! HTML cresceu de ${beforeReplace} para ${afterReplace} chars (+${
            afterReplace - beforeReplace
          } chars)`
        );
      } else {
        console.log(
          '⚠️ [processHtml] Nenhum código para injetar (injections vazio)'
        );
      }
    } else {
      console.log(
        '❌ [processHtml] PULANDO INJEÇÃO - injectCustom é FALSE ou undefined'
      );
    }

    // Adicionar script de modo edição
    if (options.editMode) {
      console.log('✅ [processHtml] Injetando script de modo edição');
      html = html.replace(/<\/body>/i, `${this.getEditModeScript()}\n</body>`);
    }

    console.log(
      '🔧 [processHtml] ========== PROCESSAMENTO FINALIZADO =========='
    );
    return html;
  }

  /**
   * 📊 Inicializar stats
   */
  private getCleaningStats(): CleaningStats {
    return {
      metaPixels: 0,
      analyticsScripts: 0,
      trackingScripts: 0,
      webhooks: 0,
    };
  }

  // ============================================
  // CÓDIGOS DE INJEÇÃO (Meta Pixel, Google Analytics, etc)
  // ============================================

  private getMetaPixelCode(pixelId: string): string {
    return `
<!-- Meta Pixel Code (Tuglet) -->
<script data-tuglet="true">
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->
`;
  }

  private getGoogleTagCode(gtagId: string): string {
    return `
<!-- Google tag (gtag.js) (Tuglet) -->
<script async data-tuglet="true" src="https://www.googletagmanager.com/gtag/js?id=${gtagId}"></script>
<script data-tuglet="true">
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${gtagId}');
</script>
<!-- End Google tag -->
`;
  }

  private getMicrosoftClarityCode(clarityId: string): string {
    return `
<!-- Microsoft Clarity (Tuglet) -->
<script type="text/javascript" data-tuglet="true">
(function(c,l,a,r,i,t,y){
    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "${clarityId}");
</script>
<!-- End Microsoft Clarity -->
`;
  }

  private getWhatsAppButtonCode(phoneNumber: string): string {
    return `
<!-- WhatsApp Button (Tuglet) -->
<style data-tuglet="true">
.whatsapp-float {
  position: fixed;
  width: 60px;
  height: 60px;
  bottom: 40px;
  right: 40px;
  background-color: #25d366;
  color: #FFF;
  border-radius: 50px;
  text-align: center;
  font-size: 30px;
  box-shadow: 2px 2px 3px #999;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
}
.whatsapp-float:hover {
  background-color: #20BA5A;
}
</style>
<a href="https://wa.me/${phoneNumber}" class="whatsapp-float" target="_blank" rel="noopener noreferrer" data-tuglet="true">
  <svg viewBox="0 0 32 32" width="32" height="32" fill="white">
    <path d="M16 0C7.164 0 0 7.164 0 16c0 2.832.74 5.488 2.04 7.792L0 32l8.384-2.008A15.926 15.926 0 0016 32c8.836 0 16-7.164 16-16S24.836 0 16 0zm0 29.448c-2.368 0-4.664-.624-6.672-1.8l-.48-.288-4.976 1.192 1.232-4.872-.312-.504A13.368 13.368 0 012.552 16c0-7.416 6.032-13.448 13.448-13.448 7.416 0 13.448 6.032 13.448 13.448 0 7.416-6.032 13.448-13.448 13.448z"/>
    <path d="M22.888 18.88c-.408-.2-2.408-1.184-2.784-1.32-.376-.136-.648-.2-.92.2-.272.4-1.056 1.32-1.296 1.6-.24.272-.48.312-.888.104-.408-.2-1.72-.632-3.272-2.008-1.208-1.072-2.024-2.4-2.264-2.808-.24-.408-.024-.632.176-.832.184-.184.408-.48.608-.72.2-.24.272-.408.408-.68.136-.272.068-.504-.032-.704-.104-.2-.92-2.208-1.256-3.024-.328-.8-.664-.688-.92-.704-.232-.016-.504-.016-.776-.016-.272 0-.72.104-1.096.504-.376.408-1.44 1.408-1.44 3.44 0 2.032 1.472 3.992 1.68 4.264.2.272 2.936 4.48 7.112 6.28.992.432 1.768.688 2.376.88.992.312 1.896.272 2.608.168.8-.12 2.408-.984 2.752-1.936.344-.952.344-1.768.24-1.936-.104-.168-.376-.272-.784-.472z"/>
  </svg>
</a>
`;
  }

  private getProtectionScript(): string {
    // Detectar se está em produção
    const isProduction = process.env.NODE_ENV === 'production';
    
    return `
<script id="cp-protection-script" data-tuglet="true">
// 🛡️ PROTEÇÃO ANTI-CLONE E ANTI-DEVTOOLS - EXECUTAR IMEDIATAMENTE
(function() {
  'use strict';
  
  // 🔇 Sistema de logs condicionais: só loga em desenvolvimento
  var IS_PRODUCTION = ${isProduction};
  var debugLog = function() {
    if (!IS_PRODUCTION) {
      console.log.apply(console, arguments);
    }
  };
  var debugWarn = function() {
    if (!IS_PRODUCTION) {
      console.warn.apply(console, arguments);
    }
  };

  // ============================================
  // 🚨 PROTEÇÃO PRIORITÁRIA: Bloquear ANTES de tudo
  // ============================================

  // Lista de palavras ofensivas para bloquear (NOTA: 'clone' removido pois conflita com o editor)
  var blockedWords = ['lixo', 'merda', 'fracassado', 'idiota', 'pirata', 'espionar', 'otário', 'babaca', 'corno', 'porra', 'caralho', 'fdp', 'aqui pra tu', 'motoboy', 'colchão'];

  // ============================================
  // 🛡️ PROTEÇÃO CORS: Bloquear APENAS Cloudflare RUM
  // ============================================
  try {
    var OriginalXMLHttpRequest = window.XMLHttpRequest;
    window.XMLHttpRequest = function() {
      var xhr = new OriginalXMLHttpRequest();
      var originalOpen = xhr.open;
      
      xhr.open = function(method, url) {
        var urlStr = String(url);
        
        // Bloquear APENAS /cdn-cgi/rum (Cloudflare RUM que causa erro CORS)
        if (urlStr.includes('/cdn-cgi/rum')) {
          debugWarn('🛡️ [CORS Protection] XMLHttpRequest bloqueado:', urlStr.substring(0, 100));
          // Substituir por endpoint fake que retorna sucesso
          arguments[1] = 'data:application/json,{}';
        }
        
        return originalOpen.apply(this, arguments);
      };
      
      return xhr;
    };
    
    debugLog('✅ [CORS Protection] XMLHttpRequest interceptado para /cdn-cgi/rum');
  } catch (e) {
    debugWarn('⚠️ [CORS Protection] Erro ao interceptar XMLHttpRequest:', e);
  }

  // ============================================
  // 🛡️ PROTEÇÃO ANTI-DEVTOOLS #1: Falsificar dimensões da janela
  // A técnica mais comum é comparar outerWidth - innerWidth
  // ============================================
  try {
    // Fazer outerWidth/outerHeight sempre retornarem o mesmo que inner
    Object.defineProperty(window, 'outerWidth', {
      get: function() { return window.innerWidth; },
      configurable: true
    });
    Object.defineProperty(window, 'outerHeight', {
      get: function() { return window.innerHeight; },
      configurable: true
    });
  } catch(e) {}

  // ============================================
  // 🛡️ PROTEÇÃO ANTI-DEVTOOLS #2: Bloquear detecção via console
  // Alguns scripts usam console.log com objetos que têm getters
  // ============================================
  try {
    var originalConsoleLog = console.log;
    var originalConsoleDir = console.dir;
    var originalConsoleTable = console.table;

    // Interceptar console.log para evitar detecção via getters
    console.log = function() {
      // Não executar se detectar objeto com getter (técnica de detecção)
      for (var i = 0; i < arguments.length; i++) {
        var arg = arguments[i];
        if (arg && typeof arg === 'object') {
          try {
            // Detectar se o objeto foi criado para detectar DevTools
            var str = Object.prototype.toString.call(arg);
            if (str.indexOf('DevTools') !== -1) return;
          } catch(e) {}
        }
      }
      return originalConsoleLog.apply(console, arguments);
    };
  } catch(e) {}

  // ============================================
  // 🛡️ PROTEÇÃO ANTI-DEVTOOLS #3: Bloquear debugger statements
  // ============================================
  try {
    // Sobrescrever Function.prototype.constructor para remover debugger
    var originalFunction = Function;
    Function = function() {
      var args = Array.prototype.slice.call(arguments);
      var body = args[args.length - 1] || '';
      if (typeof body === 'string' && body.indexOf('debugger') !== -1) {
        // Remover debugger statements
        args[args.length - 1] = body.replace(/debugger/g, '');
      }
      return originalFunction.apply(this, args);
    };
    Function.prototype = originalFunction.prototype;
  } catch(e) {}

  // ============================================
  // 🛡️ PROTEÇÃO ANTI-DEVTOOLS #4: Bloquear setInterval com debugger
  // ============================================
  var originalSetInterval = window.setInterval;
  window.setInterval = function(callback, delay) {
    // Se o callback contém debugger ou é muito rápido (anti-devtools típico)
    if (typeof callback === 'string' && callback.indexOf('debugger') !== -1) {
      return 0; // Não executar
    }
    if (typeof callback === 'function') {
      var funcStr = callback.toString();
      if (funcStr.indexOf('debugger') !== -1) {
        return 0; // Não executar
      }
      // Se é um intervalo muito rápido (< 100ms), pode ser detecção de devtools
      if (delay < 100 && (funcStr.indexOf('outer') !== -1 || funcStr.indexOf('inner') !== -1)) {
        return 0; // Não executar
      }
    }
    return originalSetInterval.apply(window, arguments);
  };

  // ============================================
  // 🛡️ PROTEÇÃO ANTI-DEVTOOLS #5: Bloquear detecção via performance.now()
  // ============================================
  try {
    var originalPerformanceNow = performance.now.bind(performance);
    var lastTime = 0;
    performance.now = function() {
      var now = originalPerformanceNow();
      // Se a diferença é muito grande (debugger pausou), retornar tempo falso
      if (lastTime > 0 && (now - lastTime) > 100) {
        return lastTime + 16; // Simular 60fps normal
      }
      lastTime = now;
      return now;
    };
  } catch(e) {}

  // ============================================
  // 🛡️ PROTEÇÃO ANTI-DEVTOOLS #6: Bloquear Date.now() para timing attacks
  // ============================================
  try {
    var originalDateNow = Date.now;
    var lastDateNow = 0;
    Date.now = function() {
      var now = originalDateNow();
      if (lastDateNow > 0 && (now - lastDateNow) > 100) {
        return lastDateNow + 16;
      }
      lastDateNow = now;
      return now;
    };
  } catch(e) {}

  // ============================================
  // 🛡️ PROTEÇÃO ANTI-RESIZE: Bloquear callbacks de resize maliciosos
  // ============================================
  var originalAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    // Interceptar eventos que podem ser usados para detecção
    if (type === 'resize' || type === 'orientationchange') {
      // Verificar se o listener tenta acessar outerWidth/innerWidth
      var listenerStr = listener.toString();
        if (listenerStr.includes('outerWidth') ||
          listenerStr.includes('outerHeight') ||
          listenerStr.includes('innerWidth') ||
          listenerStr.includes('innerHeight') ||
          listenerStr.includes('location') ||
          listenerStr.includes('bounce') ||
          listenerStr.includes('REDIR')) {
        debugWarn('🛡️ [Protection] Listener de resize malicioso BLOQUEADO');
        return function() {}; // Retornar função vazia
      }

      var wrappedListener = function(event) {
        try {
          listener.apply(this, arguments);
        } catch (e) {
          debugWarn('🛡️ [Protection] Erro em resize listener capturado');
        }
      };
      return originalAddEventListener.call(this, type, wrappedListener, options);
    }

    // Bloquear contextmenu que redireciona
    if (type === 'contextmenu') {
      var listenerStr = listener.toString();
      if (listenerStr.includes('location') ||
          listenerStr.includes('bounce') ||
          listenerStr.includes('REDIR') ||
          listenerStr.includes('redirect')) {
        debugWarn('🛡️ [Protection] Listener de contextmenu malicioso BLOQUEADO');
        return function() {};
      }
    }

    // Bloquear keydown que redireciona em F12
    if (type === 'keydown') {
      var listenerStr = listener.toString();
      if ((listenerStr.includes('f12') || listenerStr.includes('F12')) &&
          (listenerStr.includes('location') || listenerStr.includes('bounce') || listenerStr.includes('REDIR'))) {
        debugWarn('🛡️ [Protection] Listener de keydown anti-devtools BLOQUEADO');
        return function() {};
      }
    }

    return originalAddEventListener.call(this, type, listener, options);
  };

  // ============================================
  // 🛡️ PROTEÇÃO ANTI-MATCHMEDIA
  // ============================================
  var originalMatchMedia = window.matchMedia;
  window.matchMedia = function(query) {
    var result = originalMatchMedia.call(window, query);
    var originalAddListener = result.addListener || result.addEventListener;
    if (originalAddListener) {
      result.addListener = result.addEventListener = function(callback) {
        var wrappedCallback = function(event) {
          try { callback.apply(this, arguments); } catch (e) {}
        };
        return originalAddListener.call(result, wrappedCallback);
      };
    }
    return result;
  };

  // ============================================
  // 🛡️ PROTEÇÃO ANTI-RESIZEOBSERVER
  // ============================================
  if (window.ResizeObserver) {
    var OriginalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = function(callback) {
      var wrappedCallback = function(entries, observer) {
        try { callback.apply(this, arguments); } catch (e) {}
      };
      return new OriginalResizeObserver(wrappedCallback);
    };
    window.ResizeObserver.prototype = OriginalResizeObserver.prototype;
  }

  // ============================================
  // 🛡️ PROTEÇÃO ANTI-MUTATIONOBSERVER
  // ============================================
  var OriginalMutationObserver = window.MutationObserver;
  window.MutationObserver = function(callback) {
    var wrappedCallback = function(mutations, observer) {
      try { callback.apply(this, arguments); } catch (e) {}
    };
    return new OriginalMutationObserver(wrappedCallback);
  };
  window.MutationObserver.prototype = OriginalMutationObserver.prototype;

  debugLog('🛡️ [Protection] Inicializando proteção COMPLETA anti-clone e anti-devtools...');

  // ============================================
  // 🛡️ PROTEÇÃO 1: Fazer parecer que NÃO está em iframe
  // ============================================
  try {
    // Fazer window.frameElement retornar null (como se não estivesse em iframe)
    Object.defineProperty(window, 'frameElement', {
      get: function() { return null; },
      configurable: false
    });
    debugLog('✅ [Protection] frameElement mascarado');
  } catch (e) {}

  try {
    // Fazer self === top sempre (como se não estivesse em iframe)
    if (window.self !== window.top) {
      Object.defineProperty(window, 'top', {
        get: function() { return window.self; },
        configurable: false
      });
      Object.defineProperty(window, 'parent', {
        get: function() { return window.self; },
        configurable: false
      });
    }
    debugLog('✅ [Protection] top/parent mascarados');
  } catch (e) {}

  // ============================================
  // 🛡️ PROTEÇÃO 2: Bloquear detecção de domínio/origin
  // ============================================
  try {
    // Salvar hostname original para uso legítimo
    var originalHostname = window.location.hostname;

    // Interceptar comparações de hostname
    var originalLocDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    if (originalLocDescriptor && originalLocDescriptor.get) {
      // Manter location funcional mas proteger contra detecção
    }
    debugLog('✅ [Protection] Hostname protegido');
  } catch (e) {}

  // ============================================
  // 🛡️ PROTEÇÃO 3: Bloquear document.write malicioso
  // ============================================
  var originalWrite = document.write;
  var originalWriteln = document.writeln;
  var blockedWords = ['lixo', 'merda', 'fracassado', 'idiota', 'pirata', 'espionar', 'otário', 'babaca', 'corno'];

  document.write = function(content) {
    if (typeof content === 'string') {
      var lowerContent = content.toLowerCase();
      for (var i = 0; i < blockedWords.length; i++) {
        if (lowerContent.indexOf(blockedWords[i]) !== -1) {
          debugWarn('🛡️ [Protection] document.write malicioso BLOQUEADO');
          return;
        }
      }
    }
    return originalWrite.apply(document, arguments);
  };

  document.writeln = function(content) {
    if (typeof content === 'string') {
      var lowerContent = content.toLowerCase();
      for (var i = 0; i < blockedWords.length; i++) {
        if (lowerContent.indexOf(blockedWords[i]) !== -1) {
          debugWarn('🛡️ [Protection] document.writeln malicioso BLOQUEADO');
          return;
        }
      }
    }
    return originalWriteln.apply(document, arguments);
  };
  debugLog('✅ [Protection] document.write protegido');

  // ============================================
  // 🛡️ PROTEÇÃO 4: Bloquear innerHTML malicioso
  // NOTA: Desativado pois interfere com operações legítimas do editor (Undo/Redo)
  // ============================================
  // var originalInnerHTMLDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  // if (originalInnerHTMLDescriptor && originalInnerHTMLDescriptor.set) {
  //   Object.defineProperty(Element.prototype, 'innerHTML', { ... });
  // }
  debugLog('ℹ️ [Protection] innerHTML protection desativada (compatibilidade com editor)');

  // ============================================
  // 🛡️ PROTEÇÃO 5: Bloquear textContent malicioso
  // ============================================
  var originalTextContentDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  if (originalTextContentDescriptor && originalTextContentDescriptor.set) {
    Object.defineProperty(Node.prototype, 'textContent', {
      get: originalTextContentDescriptor.get,
      set: function(value) {
        if (typeof value === 'string') {
          var lowerValue = value.toLowerCase();
          for (var i = 0; i < blockedWords.length; i++) {
            if (lowerValue.indexOf(blockedWords[i]) !== -1) {
              debugWarn('🛡️ [Protection] textContent malicioso BLOQUEADO');
              return;
            }
          }
        }
        return originalTextContentDescriptor.set.call(this, value);
      },
      configurable: true
    });
    debugLog('✅ [Protection] textContent protegido');
  }

  // ============================================
  // 🛡️ PROTEÇÃO 6: Bloquear alerts maliciosos
  // ============================================
  var originalAlert = window.alert;
  window.alert = function(message) {
    if (typeof message === 'string') {
      var lowerMsg = message.toLowerCase();
      for (var i = 0; i < blockedWords.length; i++) {
        if (lowerMsg.indexOf(blockedWords[i]) !== -1) {
          debugWarn('🛡️ [Protection] Alert malicioso BLOQUEADO');
          return;
        }
      }
    }
    return originalAlert.apply(window, arguments);
  };
  debugLog('✅ [Protection] alert protegido');

  // ============================================
  // 🛡️ PROTEÇÃO 7: Bloquear redirecionamentos maliciosos
  // ============================================

  // Lista de URLs/caminhos de proteção conhecidos
  var blockedPaths = ['acesso', 'blocked', 'protect', 'redirect', 'clone', 'hack', 'pirate', 'blocked.html'];

  function isBlockedUrl(url) {
    if (!url) return false;
    var lowerUrl = url.toString().toLowerCase();
    for (var i = 0; i < blockedPaths.length; i++) {
      if (lowerUrl.includes(blockedPaths[i])) return true;
    }
    return false;
  }

  try {
    // Interceptar location.replace
    var originalReplace = window.location.replace;
    if (originalReplace) {
      Object.defineProperty(window.location, 'replace', {
        value: function(url) {
          if (isBlockedUrl(url)) {
            debugWarn('🛡️ [Protection] location.replace BLOQUEADO:', url);
            return;
          }
          return originalReplace.apply(window.location, arguments);
        },
        writable: false,
        configurable: false
      });
    }
  } catch (e) {}

  try {
    // Interceptar location.assign
    var originalAssign = window.location.assign;
    if (originalAssign) {
      Object.defineProperty(window.location, 'assign', {
        value: function(url) {
          if (isBlockedUrl(url)) {
            debugWarn('🛡️ [Protection] location.assign BLOQUEADO:', url);
            return;
          }
          return originalAssign.apply(window.location, arguments);
        },
        writable: false,
        configurable: false
      });
    }
  } catch (e) {}

  try {
    // Interceptar location.href set
    var originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    if (originalLocationDescriptor) {
      var originalHref = originalLocationDescriptor.get.call(window);

      Object.defineProperty(window, 'location', {
        get: function() {
          try {
            return originalLocationDescriptor.get.call(this);
          } catch (e) {
            return { href: '#', hostname: '', pathname: '/', search: '', hash: '' };
          }
        },
        set: function(value) {
          if (isBlockedUrl(value)) {
            debugWarn('🛡️ [Protection] Tentativa de redirect BLOQUEADA:', value);
            return;
          }
          debugWarn('🛡️ [Protection] Tentativa de redirect via location set BLOQUEADA:', value);
        },
        configurable: true
      });
    }
  } catch (e) {}

  // ============================================
  // 🛡️ PROTEÇÃO 8: Bloquear criação de elementos maliciosos
  // ============================================
  var originalCreateElement = document.createElement;
  document.createElement = function(tagName) {
    var element = originalCreateElement.apply(document, arguments);

    // Interceptar src de scripts maliciosos
    if (tagName.toLowerCase() === 'script') {
      var originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
      // Monitorar mas não bloquear scripts legítimos
    }

    return element;
  };

  // ============================================
  // 🛡️ PROTEÇÃO 9: Interceptar erros não capturados
  // ============================================
  window.addEventListener('error', function(event) {
    if (event.message) {
      var msg = event.message.toLowerCase();
      
      // Bloquear erros de cross-origin
      if (msg.indexOf('location') !== -1 || msg.indexOf('blocked') !== -1 || msg.indexOf('cross-origin') !== -1) {
        debugWarn('⚠️ [Protection] Erro cross-origin suprimido');
        event.preventDefault();
        return true;
      }
      
      // Bloquear erros de sintaxe JavaScript (geralmente causados por HTML sendo interpretado como JS)
      if (msg.indexOf('unexpected token') !== -1 || 
          msg.indexOf('syntaxerror') !== -1 ||
          msg.indexOf('unexpected identifier') !== -1) {
        debugWarn('⚠️ [Protection] Erro de sintaxe JavaScript suprimido:', msg.substring(0, 100));
        event.preventDefault();
        return true;
      }
      
      // Bloquear erros de CORS/Network
      if (msg.indexOf('failed to fetch') !== -1 || 
          msg.indexOf('network error') !== -1 ||
          msg.indexOf('networkerror') !== -1 ||
          msg.indexOf('cors') !== -1) {
        debugWarn('⚠️ [Protection] Erro de rede/CORS suprimido');
        event.preventDefault();
        return true;
      }
    }
    
    // Interceptar erros de loading de scripts
    if (event.target && (event.target.tagName === 'SCRIPT' || event.target.tagName === 'LINK')) {
      debugWarn('⚠️ [Protection] Erro ao carregar recurso externo suprimido:', event.target.src || event.target.href);
      event.preventDefault();
      return true;
    }
  }, true);

  // ============================================
  // 🛡️ PROTEÇÃO 10: Interceptar promessas rejeitadas
  // ============================================
  window.addEventListener('unhandledrejection', function(event) {
    var reason = String(event.reason || '').toLowerCase();
    
    // Bloquear erros relacionados a CORS, fetch, syntax errors
    if (reason.indexOf('cors') !== -1 ||
        reason.indexOf('failed to fetch') !== -1 ||
        reason.indexOf('network error') !== -1 ||
        reason.indexOf('syntaxerror') !== -1 ||
        reason.indexOf('unexpected token') !== -1 ||
        reason.indexOf('cross-origin') !== -1 ||
        reason.indexOf('blocked') !== -1) {
      debugWarn('⚠️ [Protection] Promise rejection suprimida:', reason.substring(0, 100));
      event.preventDefault();
    }
  });

  debugLog('✅ [Protection] Interceptadores de erro configurados');

  // ============================================
  // 🛡️ PROTEÇÃO 11: Remover conteúdo ofensivo existente
  // ============================================
  function removeOffensiveContent() {
    var allElements = document.querySelectorAll('*');
    for (var i = 0; i < allElements.length; i++) {
      var el = allElements[i];
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;

      var text = (el.textContent || '').toLowerCase();
      for (var j = 0; j < blockedWords.length; j++) {
        if (text.indexOf(blockedWords[j]) !== -1 && el.innerHTML.length < 1000) {
          // Verificar se é conteúdo anti-clone (não conteúdo legítimo do site)
          var parent = el.parentElement;
          if (parent && (
            parent.style.display === 'none' ||
            el.style.display === 'none' ||
            window.getComputedStyle(el).display === 'none' ||
            text.indexOf('aqui pra tu') !== -1 ||
            text.indexOf('espionar') !== -1
          )) {
            debugWarn('🛡️ [Protection] Removendo conteúdo ofensivo:', el.tagName);
            el.remove();
            break;
          }
        }
      }
    }
  }

  // Executar limpeza após DOM carregar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', removeOffensiveContent);
  } else {
    removeOffensiveContent();
  }

  // Executar limpeza também após um delay (para conteúdo dinâmico)
  setTimeout(removeOffensiveContent, 500);
  setTimeout(removeOffensiveContent, 1500);
  setTimeout(removeOffensiveContent, 3000);

  debugLog('✅ [Protection] Proteção COMPLETA ativada');
})();
</script>
`;
  }

  private getEditModeScript(): string {
    // Detectar se está em produção
    const isProduction = process.env.NODE_ENV === 'production';
    
    return `
<script id="cp-editor-script" data-tuglet="true">
(function() {
  'use strict';
  
  // 🔇 Sistema de logs condicionais: só loga em desenvolvimento
  var IS_PRODUCTION = ${isProduction};
  var debugLog = function() {
    if (!IS_PRODUCTION) {
      console.log.apply(console, arguments);
    }
  };
  var debugWarn = function() {
    if (!IS_PRODUCTION) {
      console.warn.apply(console, arguments);
    }
  };
  var debugError = function() {
    if (!IS_PRODUCTION) {
      console.error.apply(console, arguments);
    }
  };
  
  debugLog('🎨 [Tuglet Editor] Inicializando editor visual...');

  let hoveredElement = null;
  let selectedElement = null;
  const HIGHLIGHT_CLASS = 'cp-hover-highlight';
  const SELECTED_CLASS = 'cp-selected';
  var currentEditorViewport = 'desktop';

  // ============================================
  // 🎯 UTILIDADE: Encontrar elemento por XPath
  // ============================================
  function getElementByXPath(xpath) {
    try {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      return result.singleNodeValue;
    } catch (e) {
      debugError('❌ Erro ao encontrar elemento por XPath:', xpath, e);
      return null;
    }
  }

  // ============================================
  // 🎬 UTILIDADE: Converter URL do YouTube para formato de embed
  // ============================================
  function convertToYouTubeEmbed(url, preserveExistingParams = false) {
    // Verificar se é uma URL do YouTube
    if (!url || typeof url !== 'string') return url;

    const lowerUrl = url.toLowerCase();
    if (!lowerUrl.includes('youtube.com') && !lowerUrl.includes('youtu.be')) {
      return url; // Não é YouTube, retornar como está
    }

    try {
      let videoId = null;

      // Extrair ID do vídeo de diferentes formatos de URL
      // Formato 1: https://www.youtube.com/watch?v=VIDEO_ID
      if (url.includes('watch?v=')) {
        const match = url.match(/[?&]v=([^&]+)/);
        if (match) videoId = match[1];
      }
      // Formato 2: https://youtu.be/VIDEO_ID
      else if (url.includes('youtu.be/')) {
        const match = url.match(/youtu\\.be\\/([^?&]+)/);
        if (match) videoId = match[1];
      }
      // Formato 3: https://www.youtube.com/embed/VIDEO_ID (já é embed)
      else if (url.includes('/embed/')) {
        const match = url.match(/\\/embed\\/([^?&]+)/);
        if (match) videoId = match[1];
      }
      // Formato 4: https://www.youtube.com/v/VIDEO_ID
      else if (url.includes('/v/')) {
        const match = url.match(/\\/v\\/([^?&]+)/);
        if (match) videoId = match[1];
      }

      if (!videoId) {
        debugWarn('⚠️ [YouTube] Não foi possível extrair ID do vídeo:', url);
        return url;
      }

      // Limpar o ID de possíveis parâmetros extras
      videoId = videoId.split('&')[0].split('?')[0].split('#')[0];

      let embedUrl;

      // 🎬 ESPECIAL: Para iframes do Elementor, preservar parâmetros existentes para evitar erro 153
      if (preserveExistingParams && url.includes('/embed/')) {
        // Se já é uma URL de embed e devemos preservar parâmetros,
        // apenas atualizamos o ID do vídeo mantendo os parâmetros
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/');
        pathParts[pathParts.length - 1] = videoId; // Substituir apenas o ID
        urlObj.pathname = pathParts.join('/');

        // Garantir parâmetros essenciais para todos os ambientes
        if (!urlObj.searchParams.has('origin')) {
          const origin = getYouTubeOrigin();
          urlObj.searchParams.set('origin', origin);
        }
        if (!urlObj.searchParams.has('enablejsapi')) {
          urlObj.searchParams.set('enablejsapi', '1');
        }
        // Remover parâmetros problemáticos que causam erro 153
        urlObj.searchParams.delete('widget_referrer');
        urlObj.searchParams.delete('aoriginsup');
        urlObj.searchParams.delete('gporigin');
        urlObj.searchParams.delete('forigin');

        embedUrl = urlObj.toString();

        debugLog('🎬 [YouTube] URL Elementor atualizada (cross-origin):', {
          original: url.substring(0, 80),
          videoId: videoId,
          embed: embedUrl
        });
      } else {
        // Construir URL de embed universal para todos os ambientes
        const origin = getYouTubeOrigin();
        embedUrl = \`https://www.youtube.com/embed/\${videoId}?enablejsapi=1&origin=\${origin}&rel=0&modestbranding=1&iv_load_policy=3&cc_load_policy=0\`;

        debugLog('🎬 [YouTube] URL universal criada:', {
          original: url.substring(0, 80),
          videoId: videoId,
          embed: embedUrl,
          origin: origin
        });
      }

      return embedUrl;
    } catch (e) {
      debugError('❌ [YouTube] Erro ao converter URL:', e);
      return url;
    }
  }

  // ============================================
  // 🌐 ORIGEM UNIVERSAL para YouTube (funciona em todos os ambientes)
  // ============================================
  function getYouTubeOrigin() {
    try {
      // 🏠 Produção: Usar o domínio atual
      if (window.location.hostname !== 'localhost' &&
          window.location.hostname !== '127.0.0.1' &&
          !window.location.hostname.includes('local')) {
        return window.location.origin;
      }

      // 🧪 Desenvolvimento: Tentar detectar a porta correta do backend
      const currentPort = window.location.port;
      const currentHost = window.location.hostname;

      // Detectar se estamos no frontend (porta 5173) e usar backend (porta 3333)
      if (currentPort === '5173') {
        const backendOrigin = \`\${window.location.protocol}//\${currentHost}:3333\`;
        debugLog('🎬 [YouTube] Detectado frontend 5173, usando backend 3333:', backendOrigin);
        return backendOrigin;
      }

      // 🎯 Se já estamos na porta correta ou não conseguiu detectar
      const fallbackOrigin = \`\${window.location.protocol}//\${currentHost}:\${currentPort || '3333'}\`;
      debugLog('🎬 [YouTube] Usando origem atual:', fallbackOrigin);
      return fallbackOrigin;

    } catch (e) {
      debugWarn('⚠️ [YouTube] Erro ao detectar origem, usando fallback');
      // 🛡️ Fallback universal que funciona na maioria dos casos
      return 'https://localhost:3333';
    }
  }

  // ============================================
  // 🛡️ PREPARAÇÃO UNIVERSAL de iframe YouTube (todos os ambientes)
  // ============================================
  function prepareUniversalYouTubeIframe(iframe) {
    try {
      // 🎬 ATRIBUTOS ESSENCIAIS para YouTube funcionar em qualquer ambiente
      const essentialAttributes = {
        'allow': 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
        'allowfullscreen': 'true',
        'referrerpolicy': 'strict-origin-when-cross-origin',
        'frameborder': '0',
        'loading': 'lazy'
      };

      // Aplicar atributos essenciais apenas se não existirem
      Object.entries(essentialAttributes).forEach(([attr, value]) => {
        if (!iframe.hasAttribute(attr)) {
          iframe.setAttribute(attr, value);
          debugLog(\`🎬 [YouTube] Atributo "\${attr}" configurado: \${value}\`);
        }
      });

      // 🌐 DETECTAR E AJUSTAR origem para compatibilidade cross-origin
      const currentSrc = iframe.getAttribute('src') || '';
      if (currentSrc.includes('youtube.com/embed/')) {
        try {
          const urlObj = new URL(currentSrc);
          if (!urlObj.searchParams.has('origin') ||
              urlObj.searchParams.get('origin').includes('localhost')) {
            const properOrigin = getYouTubeOrigin();
            urlObj.searchParams.set('origin', properOrigin);
            const updatedSrc = urlObj.toString();
            iframe.setAttribute('src', updatedSrc);
            debugLog('🎬 [YouTube] Origem corrigida para:', properOrigin);
          }
        } catch (e) {
          debugWarn('⚠️ [YouTube] Erro ao ajustar origem:', e.message);
        }
      }

      // 🛡️ LIMPAR parâmetros problemáticos que causam erro 153
      if (currentSrc.includes('youtube.com')) {
        try {
          const urlObj = new URL(currentSrc);
          const problematicParams = ['widget_referrer', 'aoriginsup', 'gporigin', 'forigin', 'widgetid'];
          let removedParams = [];

          problematicParams.forEach(param => {
            if (urlObj.searchParams.has(param)) {
              urlObj.searchParams.delete(param);
              removedParams.push(param);
            }
          });

          if (removedParams.length > 0) {
            const cleanedSrc = urlObj.toString();
            iframe.setAttribute('src', cleanedSrc);
            debugLog('🎬 [YouTube] Parâmetros problemáticos removidos:', removedParams);
          }
        } catch (e) {
          debugWarn('⚠️ [YouTube] Erro ao limpar parâmetros:', e.message);
        }
      }

      debugLog('✅ [YouTube] Iframe preparado para ambiente universal');

    } catch (e) {
      debugError('❌ [YouTube] Erro ao preparar iframe universal:', e);
    }
  }

  // ============================================
  // 🎯 UTILIDADE: Detectar se elemento é um vídeo
  // ============================================
  function isVideoElement(element) {
    if (!element || !element.tagName) return false;

    const tagName = element.tagName.toUpperCase();

    // 1. Tags HTML5 de vídeo nativas
    if (tagName === 'VIDEO') {
      return true;
    }

    // 2. Iframes de plataformas de vídeo conhecidas
    if (tagName === 'IFRAME') {
      // Verificar classes do iframe - Elementor e outros builders usam classes específicas
      const className = (element.className || '').toLowerCase();
      const videoClasses = ['elementor-video', 'wp-video', 'video-iframe', 'vc_video'];
      for (let i = 0; i < videoClasses.length; i++) {
        if (className.includes(videoClasses[i])) {
          debugLog('🎬 [isVideoElement] Iframe detectado por classe:', videoClasses[i]);
          return true;
        }
      }

      // Coletar todos os atributos possíveis de src (lazy loading, etc)
      const src = element.src || element.getAttribute('src') || '';
      const dataSrc = element.getAttribute('data-src') || '';
      const dataLazySrc = element.getAttribute('data-lazy-src') || '';
      const dataVideoSrc = element.getAttribute('data-video-src') || '';
      const dataSettings = element.getAttribute('data-settings') || '';
      
      const combinedSrc = (src + ' ' + dataSrc + ' ' + dataLazySrc + ' ' + dataVideoSrc + ' ' + dataSettings).toLowerCase();

      // Lista expandida de plataformas de vídeo
      const videoPlatforms = [
        'youtube.com',
        'youtu.be',
        'youtube-nocookie.com',
        'vimeo.com',
        'player.vimeo.com',
        'pandavideo.com',
        'player.pandavideo.com',
        'vturb.com.br',
        'player.vturb.com.br',
        'wistia.com',
        'fast.wistia.com',
        'wistia.net',
        'dailymotion.com',
        'player.dailymotion.com',
        'dai.ly',
        'twitch.tv',
        'player.twitch.tv',
        'facebook.com/plugins/video',
        'streamable.com',
        'vid.me',
        'brightcove.com',
        'players.brightcove.net',
        'jwplatform.com',
        'content.jwplatform.com',
        'jwplayer.com',
        'kaltura.com',
        'cdnapisec.kaltura.com',
        'vidyard.com',
        'play.vidyard.com',
        'sproutvideo.com',
        'videos.sproutvideo.com',
        'vzaar.com',
        'view.vzaar.com',
        'videoask.com',
        'bitchute.com',
        'rumble.com',
        'loom.com',
        'embed.loom.com'
      ];

      // Verificar se o src contém alguma das plataformas
      for (let i = 0; i < videoPlatforms.length; i++) {
        if (combinedSrc.includes(videoPlatforms[i])) {
          return true;
        }
      }
    }

    // 3. Divs que contêm players de vídeo (APENAS se tiver iframe ou video filho DIRETO)
    if (tagName === 'DIV') {
      const className = (element.className || '').toLowerCase();
      const id = (element.id || '').toLowerCase();

      // Lista RESTRITA de keywords para evitar falsos positivos
      const videoKeywords = [
        'video-player',
        'video-container',
        'video-wrapper',
        'player-wrapper',
        'embed-player',
        'youtube-player',
        'vimeo-player',
        'panda-player',
        'vturb-player',
        'wistia-player'
      ];

      // APENAS marcar como vídeo se:
      // 1. Tiver uma keyword específica E
      // 2. Tiver um iframe ou video DIRETO como filho
      let hasVideoKeyword = false;
      for (let i = 0; i < videoKeywords.length; i++) {
        if (className.includes(videoKeywords[i]) || id.includes(videoKeywords[i])) {
          hasVideoKeyword = true;
          break;
        }
      }

      if (hasVideoKeyword) {
        // Verificar se tem iframe ou video como filho DIRETO (não buscar em profundidade)
        const children = element.children;
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (child.tagName === 'IFRAME' || child.tagName === 'VIDEO') {
            return true;
          }
        }
      }
    }

    return false;
  }

  // ============================================
  // 🎠 UTILIDADE: Detectar se elemento é um slider/carousel
  // ============================================
  function detectSliderType(element) {
    if (!element || !element.tagName) return null;
    
    const className = (element.className || '').toLowerCase();
    const id = (element.id || '').toLowerCase();
    
    debugLog('🎠 [detectSlider] Verificando elemento:', { tagName: element.tagName, className, id });
    
    // 1. Swiper (mais comum, usado pelo Elementor)
    if (className.includes('swiper') || className.includes('elementor-swiper')) {
      debugLog('🎠 [detectSlider] Swiper detectado!');
      
      // Tentar obter instância do Swiper
      let swiperInstance = null;
      let config = {};
      
      try {
        // Swiper armazena a instância em element.swiper
        if (element.swiper) {
          swiperInstance = element.swiper;
          config = swiperInstance.params || {};
          debugLog('🎠 [Swiper] Instância encontrada:', config);
        }
      } catch (e) {
        debugWarn('⚠️ [Swiper] Erro ao acessar instância:', e);
      }
      
      return {
        type: 'swiper',
        hasInstance: !!swiperInstance,
        config: {
          autoplay: config.autoplay || false,
          speed: config.speed || 300,
          delay: (config.autoplay && config.autoplay.delay) || 3000,
          loop: config.loop || false,
          navigation: config.navigation || false,
          pagination: config.pagination || false,
          slidesPerView: config.slidesPerView || 1,
          spaceBetween: config.spaceBetween || 0
        }
      };
    }
    
    // 2. Slick Slider (jQuery)
    if (className.includes('slick-slider') || className.includes('slick-list')) {
      debugLog('🎠 [detectSlider] Slick detectado!');
      
      let config = {};
      try {
        // Slick usa jQuery - tentar acessar via $.data()
        if (window.jQuery && window.jQuery(element).slick) {
          const slickData = window.jQuery(element).slick('getSlick');
          if (slickData && slickData.options) {
            config = slickData.options;
            debugLog('🎠 [Slick] Configurações encontradas:', config);
          }
        }
      } catch (e) {
        debugWarn('⚠️ [Slick] Erro ao acessar configurações:', e);
      }
      
      return {
        type: 'slick',
        hasInstance: !!config.autoplay,
        config: {
          autoplay: config.autoplay || false,
          speed: config.speed || 300,
          delay: config.autoplaySpeed || 3000,
          loop: config.infinite || false,
          navigation: config.arrows || false,
          pagination: config.dots || false,
          slidesToShow: config.slidesToShow || 1,
          slidesToScroll: config.slidesToScroll || 1
        }
      };
    }
    
    // 3. Owl Carousel (jQuery)
    if (className.includes('owl-carousel')) {
      debugLog('🎠 [detectSlider] Owl Carousel detectado!');
      
      let config = {};
      try {
        if (window.jQuery && window.jQuery(element).data) {
          const owlData = window.jQuery(element).data('owl.carousel');
          if (owlData && owlData.options) {
            config = owlData.options;
            debugLog('🎠 [Owl] Configurações encontradas:', config);
          }
        }
      } catch (e) {
        debugWarn('⚠️ [Owl] Erro ao acessar configurações:', e);
      }
      
      return {
        type: 'owl',
        hasInstance: !!config.autoplay,
        config: {
          autoplay: config.autoplay || false,
          speed: config.smartSpeed || 250,
          delay: config.autoplayTimeout || 5000,
          loop: config.loop || false,
          navigation: config.nav || false,
          pagination: config.dots || false,
          items: config.items || 1
        }
      };
    }
    
    // 4. Glide.js
    if (className.includes('glide')) {
      debugLog('🎠 [detectSlider] Glide detectado!');
      
      return {
        type: 'glide',
        hasInstance: false,
        config: {
          autoplay: false,
          speed: 400,
          delay: 3000,
          loop: true
        }
      };
    }
    
    // 5. Flickity
    if (className.includes('flickity')) {
      debugLog('🎠 [detectSlider] Flickity detectado!');
      
      let config = {};
      try {
        if (element.flickity) {
          config = element.flickity.options || {};
        }
      } catch (e) {}
      
      return {
        type: 'flickity',
        hasInstance: !!element.flickity,
        config: {
          autoplay: config.autoPlay || false,
          speed: config.selectedAttraction || 0.025,
          delay: (typeof config.autoPlay === 'number' ? config.autoPlay : 3000),
          loop: config.wrapAround || false,
          navigation: config.prevNextButtons || false,
          pagination: config.pageDots || false
        }
      };
    }
    
    debugLog('🎠 [detectSlider] Nenhum slider detectado');
    return null;
  }

  // ============================================
  // 📱 AJUSTE AUTOMÁTICO PARA MOBILE
  // ============================================
  /**
   * Aplica ajustes automáticos para mobile quando estilos são definidos
   * Previne elementos de extrapolarem a tela em dispositivos móveis
   */
  function applyMobileAutoFix(element, property, value) {
    // Propriedades que precisam de ajuste mobile
    const mobileSensitiveProps = ['width', 'height', 'padding', 'margin', 'fontSize', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom'];
    
    if (!mobileSensitiveProps.includes(property)) {
      return; // Não precisa ajuste
    }
    
    // Verificar se valor está em px fixo
    const pxMatch = value.match(/^(\d+(?:\.\d+)?)px$/);
    if (!pxMatch) {
      return; // Não é px fixo, pode ser %, vw, etc (já responsivo)
    }
    
    const pxValue = parseFloat(pxMatch[1]);
    
    // Ignorar valores muito pequenos (não causam overflow)
    if (pxValue < 20 && property !== 'fontSize') {
      return;
    }
    
    // Verificar se elemento já tem max-width definido (pode já estar responsivo)
    const computedStyle = window.getComputedStyle(element);
    if (property === 'width' && (computedStyle.maxWidth && computedStyle.maxWidth !== 'none')) {
      debugLog('📱 [MobileFix] Elemento já tem max-width, pulando ajuste');
      return;
    }
    
    debugLog(\`📱 [MobileFix] Detectado valor fixo: \${property} = \${value}\`);
    
    // Criar ID único para o elemento (se não tiver)
    if (!element.id) {
      const uniqueId = 'cp-element-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      element.id = uniqueId;
      debugLog(\`📱 [MobileFix] ID criado para elemento: \${uniqueId}\`);
    }
    
    // Usar um único elemento <style> para todos os ajustes mobile
    let mobileStyleId = 'cp-mobile-auto-fix';
    let existingStyle = document.getElementById(mobileStyleId);
    
    if (!existingStyle) {
      // Criar novo elemento <style> para media queries
      existingStyle = document.createElement('style');
      existingStyle.id = mobileStyleId;
      existingStyle.setAttribute('data-cp-mobile-fix', 'true');
      document.head.appendChild(existingStyle);
      debugLog('📱 [MobileFix] Estilo mobile global criado');
    }
    
    // Adicionar/atualizar regras CSS para mobile
    let cssRules = existingStyle.textContent || '';
    
    // Remover regra antiga deste elemento (se existir)
    const elementSelector = '#' + element.id.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    const regex = new RegExp(\`\${elementSelector}[^}]*\\{[^}]*\\}\`, 'g');
    cssRules = cssRules.replace(regex, '');
    
    // Construir nova regra CSS
    let mobileRule = \`\${elementSelector} {\`;
    
    // Aplicar ajustes baseados na propriedade
    if (property === 'width') {
      // Para width fixo: aplicar max-width: 100% em mobile
      // Manter width original mas limitar em mobile
      mobileRule += \`max-width: 100% !important; box-sizing: border-box !important;\`;
      console.log(\`📱 [MobileFix] Aplicando max-width: 100% para width fixo de \${value}\`);
    } else if (property === 'height') {
      // Para height: não forçar auto (pode quebrar), apenas limitar
      // Só aplicar se altura for muito grande (> 500px)
      if (pxValue > 500) {
        mobileRule += \`max-height: 80vh !important; overflow-y: auto !important;\`;
        console.log(\`📱 [MobileFix] Limitando height grande de \${value} para 80vh\`);
      }
    } else if (property.startsWith('padding') || property.startsWith('margin')) {
      // Para padding/margin: reduzir proporcionalmente em mobile apenas se for muito grande
      if (pxValue > 30) {
        const mobileValue = Math.max(8, Math.round(pxValue * 0.5)) + 'px'; // Reduzir 50%
        mobileRule += \`\${property}: \${mobileValue} !important;\`;
        console.log(\`📱 [MobileFix] Reduzindo \${property} de \${value} para \${mobileValue} em mobile\`);
      }
    } else if (property === 'fontSize') {
      // Para fontSize: reduzir proporcionalmente mas manter legibilidade
      if (pxValue > 24) {
        const mobileValue = Math.max(14, Math.round(pxValue * 0.75)) + 'px'; // Reduzir 25%
        mobileRule += \`font-size: \${mobileValue} !important;\`;
        console.log(\`📱 [MobileFix] Reduzindo fontSize de \${value} para \${mobileValue} em mobile\`);
      }
    }
    
    mobileRule += \`}\`;
    
    // Adicionar regra dentro de media query para mobile
    const mediaQuery = \`@media (max-width: 768px) { \${mobileRule} }\`;
    
    // Adicionar ao CSS existente
    if (cssRules.trim()) {
      existingStyle.textContent = cssRules + '\\n' + mediaQuery;
    } else {
      existingStyle.textContent = mediaQuery;
    }
    
    console.log(\`✅ [MobileFix] Ajuste mobile aplicado para #\${element.id}\`);
  }

  // ============================================
  // 📱🖥️ OVERRIDES MOBILE (viewport === 'mobile' no LayoutTab)
  // ============================================
  var CP_RESPONSIVE_OVERRIDES_ID = 'cp-responsive-overrides';
  var MOBILE_MEDIA = '@media (max-width: 768px)';

  function ensureElementCpId(element) {
    var id = element.getAttribute('data-cp-id');
    if (id) return '[data-cp-id="' + id + '"]';
    if (element.id) {
      var raw = element.id;
      var out = '';
      for (var k = 0; k < raw.length; k++) {
        var c = raw[k];
        if (/[a-zA-Z0-9_-]/.test(c)) out += c; else out += '\\\\' + c;
      }
      return '#' + out;
    }
    id = 'cp-el-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    element.setAttribute('data-cp-id', id);
    return '[data-cp-id="' + id + '"]';
  }

  function getOrCreateResponsiveOverridesStyle() {
    var el = document.getElementById(CP_RESPONSIVE_OVERRIDES_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = CP_RESPONSIVE_OVERRIDES_ID;
      el.setAttribute('data-cp-user-styles', 'true');
      document.head.appendChild(el);
    }
    return el;
  }

  function applyResponsiveMobileOverride(element, property, value) {
    var selector = ensureElementCpId(element);
    var styleEl = getOrCreateResponsiveOverridesStyle();
    var text = styleEl.textContent || '';
    var mediaStart = text.indexOf(MOBILE_MEDIA);
    var inner = '';
    var i = text.length;
    if (mediaStart >= 0) {
      var brace = text.indexOf('{', mediaStart);
      var depth = 1;
      i = brace + 1;
      while (depth > 0 && i < text.length) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
        i++;
      }
      inner = text.substring(brace + 1, i - 1);
    }
    var selectorIdx = inner.indexOf(selector);
    var ruleStart = selectorIdx >= 0 ? inner.lastIndexOf('{', selectorIdx) : -1;
    var ruleEnd = selectorIdx >= 0 ? inner.indexOf('}', selectorIdx) + 1 : 0;
    if (ruleStart < 0) ruleStart = 0;
    var rule = selectorIdx >= 0 ? inner.substring(ruleStart, ruleEnd) : '';
    var propPrefix = property + ':';
    var idx = rule.indexOf(propPrefix);
    while (idx >= 0) {
      var endIdx = rule.indexOf(';', idx);
      if (endIdx >= 0) rule = rule.substring(0, idx).trim() + (rule.substring(endIdx + 1).trim() ? ' ' + rule.substring(endIdx + 1).trim() : '');
      else rule = rule.substring(0, idx).trim();
      idx = rule.indexOf(propPrefix);
    }
    var lastBrace = rule.lastIndexOf('}');
    if (lastBrace >= 0) rule = rule.substring(0, lastBrace).trim() + ' ' + property + ': ' + value + ' !important; }';
    else rule = rule + ' ' + property + ': ' + value + ' !important;';
    if (!rule.trim() || rule.trim() === '}') rule = selector + ' { ' + property + ': ' + value + ' !important; }';
    var newInner = selectorIdx >= 0 ? inner.substring(0, ruleStart) + rule + inner.substring(ruleEnd) : inner + (inner ? ' ' : '') + rule;
    var newText = mediaStart >= 0 ? text.substring(0, mediaStart) + MOBILE_MEDIA + ' { ' + newInner + ' }' + text.substring(i) : MOBILE_MEDIA + ' { ' + newInner + ' }';
    styleEl.textContent = newText;
  }

  function removeResponsiveMobileOverrideForProperty(element, property) {
    var selector = element.getAttribute('data-cp-id') ? '[data-cp-id="' + element.getAttribute('data-cp-id') + '"]' : (element.id ? '#' + element.id : null);
    if (!selector) return;
    var styleEl = document.getElementById(CP_RESPONSIVE_OVERRIDES_ID);
    if (!styleEl) return;
    var text = styleEl.textContent || '';
    var mediaStart = text.indexOf(MOBILE_MEDIA);
    if (mediaStart < 0) return;
    var brace = text.indexOf('{', mediaStart);
    var depth = 1;
    var i = brace + 1;
    while (depth > 0 && i < text.length) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    }
    var inner = text.substring(brace + 1, i - 1);
    var selectorIdx = inner.indexOf(selector);
    if (selectorIdx < 0) return;
    var ruleEnd = inner.indexOf('}', selectorIdx) + 1;
    var ruleStart = inner.lastIndexOf('{', selectorIdx) + 1;
    var rule = inner.substring(ruleStart, ruleEnd);
    var propPrefix = property + ':';
    var idx = rule.indexOf(propPrefix);
    while (idx >= 0) {
      var endIdx = rule.indexOf(';', idx);
      if (endIdx >= 0) rule = rule.substring(0, idx).trim() + (rule.substring(endIdx + 1).trim() ? ' ' + rule.substring(endIdx + 1).trim() : '');
      else rule = rule.substring(0, idx).trim();
      idx = rule.indexOf(propPrefix);
    }
    rule = rule.trim();
    if (rule.length === 0 || rule === '}' || rule.indexOf('{') < 0) {
      inner = inner.substring(0, ruleStart - 1).trim() + inner.substring(ruleEnd);
    } else {
      inner = inner.substring(0, ruleStart) + rule + inner.substring(ruleEnd);
    }
    styleEl.textContent = text.substring(0, mediaStart) + MOBILE_MEDIA + ' { ' + inner + ' }' + text.substring(i);
  }

  // ============================================
  // 📱🖥️ UTILIDADE: Encontrar elementos equivalentes (versões desktop/mobile)
  // ============================================
  function findEquivalentElements(element, editType, editProperty) {
    const equivalents = [];
    const tagName = element.tagName.toLowerCase();

    // 🎯 Estratégia 1: Para TEXTO - buscar elementos com mesmo texto
    if (editType === 'content' && (editProperty === 'textContent' || editProperty === 'innerHTML')) {
      const originalText = element.textContent?.trim();
      if (originalText && originalText.length > 3 && originalText.length < 500) {
        // Buscar todos elementos do mesmo tipo com texto similar
        const sameTagElements = document.querySelectorAll(tagName);
        sameTagElements.forEach(function(el) {
          if (el !== element && el.textContent?.trim() === originalText) {
            // Verificar se parece ser uma versão responsiva (classes comuns)
            const hasResponsiveClass = hasResponsiveIndicator(el) || hasResponsiveIndicator(element);
            if (hasResponsiveClass || isLikelyResponsiveVariant(element, el)) {
              equivalents.push(el);
              console.log('📱 [Responsivo] Encontrado texto equivalente:', el.tagName, el.className);
            }
          }
        });
      }
    }

    // 🎯 Estratégia 2: Para IMAGENS - buscar imagens com mesmo src original
    if (tagName === 'img' && (editProperty === 'src' || editType === 'attribute')) {
      const originalSrc = element.getAttribute('data-cp-original-src') || element.src;
      if (originalSrc) {
        const allImages = document.querySelectorAll('img');
        allImages.forEach(function(img) {
          if (img !== element) {
            const imgSrc = img.getAttribute('data-cp-original-src') || img.src;
            // Comparar URLs (ignorando parâmetros de query)
            const srcBase = originalSrc.split('?')[0];
            const imgSrcBase = imgSrc.split('?')[0];
            if (srcBase === imgSrcBase || imgSrc.includes(srcBase.split('/').pop())) {
              equivalents.push(img);
              console.log('📱 [Responsivo] Encontrada imagem equivalente:', img.className);
            }
          }
        });
      }
    }

    // 🎯 Estratégia 3: Para LINKS - buscar links com mesmo href
    if (tagName === 'a' && editProperty === 'href') {
      const originalHref = element.href;
      if (originalHref) {
        const allLinks = document.querySelectorAll('a');
        allLinks.forEach(function(link) {
          if (link !== element && link.href === originalHref) {
            // Verificar se o texto também é similar
            if (link.textContent?.trim() === element.textContent?.trim()) {
              equivalents.push(link);
              console.log('📱 [Responsivo] Encontrado link equivalente:', link.className);
            }
          }
        });
      }
    }

    // 🎯 Estratégia 4: Para ESTILOS - buscar por classes idênticas (sem responsive prefixes)
    if (editType === 'style') {
      const classList = Array.from(element.classList).filter(function(c) {
        return !c.match(/^(mobile|desktop|hidden|visible|show|hide|d-none|d-block|d-lg|d-md|d-sm|d-xl)/i);
      });

      if (classList.length > 0) {
        const selector = classList.map(function(c) { return '.' + c; }).join('');
        try {
          const similarElements = document.querySelectorAll(tagName + selector);
          similarElements.forEach(function(el) {
            if (el !== element && isLikelyResponsiveVariant(element, el)) {
              equivalents.push(el);
              console.log('📱 [Responsivo] Encontrado elemento com mesma classe:', el.className);
            }
          });
        } catch (e) {
          // Selector inválido, ignorar
        }
      }
    }

    return equivalents;
  }

  // Verificar se elemento tem indicadores de responsividade
  function hasResponsiveIndicator(element) {
    const className = element.className || '';
    const parentClass = element.parentElement?.className || '';
    const allClasses = className + ' ' + parentClass;

    // Classes comuns de responsividade
    const responsivePatterns = [
      /mobile/i, /desktop/i, /tablet/i,
      /hidden-/i, /visible-/i, /show-/i, /hide-/i,
      /d-none/i, /d-block/i, /d-flex/i,
      /d-(sm|md|lg|xl|xxl)-/i,
      /col-(sm|md|lg|xl)/i,
      /elementor-hidden-/i,
      /wp-block-.*mobile/i,
      /only-mobile/i, /only-desktop/i
    ];

    return responsivePatterns.some(function(pattern) {
      return pattern.test(allClasses);
    });
  }

  // Verificar se dois elementos parecem ser variantes responsivas
  function isLikelyResponsiveVariant(el1, el2) {
    // Mesmo pai ou estrutura similar
    const sameParentTag = el1.parentElement?.tagName === el2.parentElement?.tagName;

    // Profundidade similar no DOM
    const depth1 = getElementDepth(el1);
    const depth2 = getElementDepth(el2);
    const similarDepth = Math.abs(depth1 - depth2) <= 3;

    // Um ou ambos têm indicadores responsivos
    const hasResponsive = hasResponsiveIndicator(el1) || hasResponsiveIndicator(el2);

    return (sameParentTag || similarDepth) && (hasResponsive || el1.tagName === el2.tagName);
  }

  function getElementDepth(element) {
    let depth = 0;
    let current = element;
    while (current.parentElement) {
      depth++;
      current = current.parentElement;
    }
    return depth;
  }

  // ============================================
  // 🎯 UTILIDADE: Gerar XPath para elemento
  // ============================================
  function getXPathForElement(element) {
    // Se o elemento tem ID único, usar //*[@id="..."] (mais confiável)
    if (element.id !== '' && document.getElementById(element.id) === element) {
      return \`//*[@id="\${element.id}"]\`;
    }

    // Se é o body, retornar path absoluto
    if (element === document.body) {
      return '/html/body';
    }

    // Se é html, retornar path absoluto
    if (element === document.documentElement) {
      return '/html';
    }

    // Construir XPath recursivo até o root
    const pathComponents = [];
    let currentElement = element;

    while (currentElement && currentElement.nodeType === 1 && currentElement !== document.documentElement) {
      let index = 1;
      let sibling = currentElement.previousSibling;

      // Contar quantos irmãos do mesmo tipo há antes deste elemento
      while (sibling) {
        if (sibling.nodeType === 1 && sibling.nodeName.toLowerCase() === currentElement.nodeName.toLowerCase()) {
          index++;
        }
        sibling = sibling.previousSibling;
      }

      const tagName = currentElement.nodeName.toLowerCase();

      // Se tem ID, usar o formato //*[@id="..."] e continuar a partir daí
      if (currentElement.id && document.getElementById(currentElement.id) === currentElement) {
        pathComponents.unshift(\`//*[@id="\${currentElement.id}"]\`);
        break; // Parar aqui pois ID é único
      } else {
        pathComponents.unshift(\`\${tagName}[\${index}]\`);
      }

      currentElement = currentElement.parentNode;
    }

    // Se não parou em um ID, adicionar /html no início
    if (!pathComponents[0] || !pathComponents[0].includes('@id')) {
      pathComponents.unshift('html');
      return '/' + pathComponents.join('/');
    }

    return pathComponents.join('/');
  }

  // ============================================
  // 🎯 BLOQUEIO TOTAL DE INTERAÇÕES EM MODO EDIÇÃO
  // ============================================

  console.log('🛡️ [Editor] Ativando bloqueio de interatividade...');

  // 🚨 CRÍTICO: Bloquear event listeners do Elementor e outros frameworks
  // Interceptar addEventListener para ter prioridade máxima
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  const originalStopPropagation = Event.prototype.stopPropagation;
  const originalStopImmediatePropagation = Event.prototype.stopImmediatePropagation;
  const editorListeners = new Set();
  let editorClickProcessed = false;

  EventTarget.prototype.addEventListener = function(type, listener, options) {
    // Se for nosso listener de editor, marcar como prioritário
    if (listener && listener.toString().includes('[Editor]')) {
      editorListeners.add(listener);
    }
    return originalAddEventListener.call(this, type, listener, options);
  };

  // ⚡ IMPEDIR que Elementor bloqueie eventos do editor
  // Sobrescrever stopPropagation temporariamente
  Event.prototype.stopPropagation = function() {
    // Se o editor ainda não processou o evento, não permitir stopPropagation
    if (!editorClickProcessed && this.type === 'click') {
      console.log('🛡️ [Editor] Bloqueando stopPropagation do Elementor');
      return;
    }
    return originalStopPropagation.call(this);
  };

  Event.prototype.stopImmediatePropagation = function() {
    // Se o editor ainda não processou o evento, não permitir stopImmediatePropagation
    if (!editorClickProcessed && this.type === 'click') {
      console.log('🛡️ [Editor] Bloqueando stopImmediatePropagation do Elementor');
      return;
    }
    return originalStopImmediatePropagation.call(this);
  };

  // ⚡ BLOQUEIO PRIORITÁRIO: Interceptar ações padrão mas PERMITIR seleção
  window.addEventListener('click', function(e) {
    console.log('🎯 [Editor] Click capturado no capture phase');
    const target = e.target;

    // 🎯 Bloquear links - prevenir APENAS navegação, permitir seleção
    if (target.tagName === 'A' || target.closest('a')) {
      console.log('🛡️ [Editor] Bloqueando navegação de link (permitindo seleção)');
      e.preventDefault(); // Bloqueia navegação
      // NÃO usar stopPropagation - permitir que evento chegue ao handler de seleção
      return false;
    }

    // 🎯 Bloquear vídeos e áudios - prevenir APENAS play, permitir seleção
    if (target.tagName === 'VIDEO' || target.tagName === 'AUDIO' || target.closest('video') || target.closest('audio')) {
      console.log('🛡️ [Editor] Bloqueando play de mídia (permitindo seleção)');
      e.preventDefault(); // Bloqueia play
      // NÃO usar stopPropagation - permitir que evento chegue ao handler de seleção

      // Pausar o vídeo se tentar dar play
      const mediaElement = target.tagName === 'VIDEO' || target.tagName === 'AUDIO' ? target : target.closest('video, audio');
      if (mediaElement && mediaElement.pause) {
        setTimeout(function() { mediaElement.pause(); }, 0);
      }
      return false;
    }

    // 🎯 Bloquear iframes - tratado via overlay (não precisa bloquear aqui)
    // O overlay captura o click e redireciona para o iframe

    // 🎯 Bloquear botões de formulário - prevenir APENAS submit, permitir seleção
    if (target.tagName === 'BUTTON' || target.closest('button')) {
      console.log('🛡️ [Editor] Bloqueando ação de botão (permitindo seleção)');
      e.preventDefault(); // Bloqueia ação do botão
      // NÃO usar stopPropagation - permitir que evento chegue ao handler de seleção
      return false;
    }

    // 🎯 Bloquear inputs de formulário (submit, etc)
    if (target.tagName === 'INPUT' && (target.type === 'submit' || target.type === 'button')) {
      console.log('🛡️ [Editor] Bloqueando ação de input (permitindo seleção)');
      e.preventDefault(); // Bloqueia submit
      // NÃO usar stopPropagation - permitir que evento chegue ao handler de seleção
      return false;
    }
  }, true); // true = capture phase (executado ANTES de qualquer outro listener)

  // 1️⃣ BLOQUEAR DOUBLE-CLICK
  window.addEventListener('dblclick', function(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, true);

  // 2️⃣ BLOQUEAR MUDANÇA DE EVENTO
  window.addEventListener('change', function(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, true);

  // 3️⃣ BLOQUEAR INPUT
  window.addEventListener('input', function(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, true);

  // 4️⃣ BLOQUEAR FOCUS
  window.addEventListener('focus', function(e) {
    e.preventDefault();
    e.stopPropagation();
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
  }, true);

  // 5️⃣ BLOQUEAR SUBMIT
  window.addEventListener('submit', function(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, true);

  // 6️⃣ BLOQUEAR PLAY/PAUSE
  window.addEventListener('play', function(e) {
    console.log('🛡️ [Editor] Bloqueando evento play');
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.target && e.target.pause) {
      e.target.pause();
    }
  }, true);

  window.addEventListener('pause', function(e) {
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, true);

  // 7️⃣ BLOQUEAR SEEKING
  window.addEventListener('seeking', function(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, true);

  // 8️⃣ BLOQUEAR CONTEXT MENU
  window.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, true);

  // 9️⃣ BLOQUEAR NAVEGAÇÃO (beforeunload)
  window.addEventListener('beforeunload', function(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, true);

  // 🔟 PERMITIR SCROLL - NÃO bloquear eventos de scroll/wheel
  // O scroll deve funcionar normalmente no modo edição
  window.addEventListener('wheel', function(e) {
    // Permitir scroll normalmente - não bloquear
    // Apenas garantir que não interfira com seleção
  }, false); // false = bubble phase (não capturar)

  window.addEventListener('scroll', function(e) {
    // Permitir scroll normalmente
    // 🔲 Atualizar posição dos resize handles durante scroll
    if (selectedElement) {
      updateResizeHandlesPosition(selectedElement);
    }
  }, false);

  // 🛡️ Preparar elementos para modo edição (sem bloquear pointer events)
  function prepareInteractiveElements() {
    console.log('🛡️ [Editor] Preparando elementos para modo edição...');

    // Pausar vídeos e áudios (mas permitir clicks para seleção)
    document.querySelectorAll('video, audio').forEach(function(media) {
      if (media.hasAttribute('data-cp-prepared')) return; // Já processado

      media.controls = false;
      media.pause();
      media.muted = true;
      media.setAttribute('data-cp-prepared', 'true');

      // Listener para pausar se tentar dar play
      media.addEventListener('play', function(e) {
        console.log('🛡️ [Editor] Pausando mídia automaticamente');
        setTimeout(function() { media.pause(); }, 0);
      }, true);
    });

    // ============================================
    // 🎬 BLOQUEAR VÍDEOS: Iframes, HTML5 Video e Players
    // ============================================
    console.log('🎬 [Editor] Bloqueando vídeos e players de mídia...');

    // 1️⃣ Bloquear TODOS os iframes (vídeos e outros) com overlay
    // ✅ MELHORADO: Verificar se é realmente um iframe antes de processar
    document.querySelectorAll('iframe').forEach(function(iframe) {
      // Verificar se é realmente um iframe (não uma div disfarçada)
      if (!iframe || iframe.tagName !== 'IFRAME' || iframe.nodeName !== 'IFRAME') {
        return; // Não é um iframe real
      }

      if (iframe.hasAttribute('data-cp-overlay-added')) return; // Já tem overlay

      const isVideo = isVideoElement(iframe);
      const isYouTube = (iframe.src || '').includes('youtube.com') ||
                       (iframe.getAttribute('data-src') || '').includes('youtube.com') ||
                       (iframe.src || '').includes('youtu.be');

      console.log(\`🎬 [Editor] Iframe detectado - É vídeo: \${isVideo} | YouTube: \${isYouTube}\`, iframe.src || iframe.getAttribute('data-src'));

      // 🛡️ PREPARAÇÃO UNIVERSAL para iframes do YouTube
      if (isYouTube) {
        try {
          prepareUniversalYouTubeIframe(iframe);
          iframe.setAttribute('data-cp-youtube-prepared', 'true');
          console.log('🎬 [Editor] Iframe YouTube preparado universalmente');
        } catch (e) {
          console.warn('⚠️ [Editor] Erro ao preparar iframe YouTube:', e.message);
        }
      }

      // ✅ CRÍTICO: Capturar dimensões ANTES de qualquer modificação
      const iframeRect = iframe.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(iframe);
      const originalWidth = iframeRect.width;
      const originalHeight = iframeRect.height;
      const aspectRatio = originalWidth / originalHeight;

      // 🚨 CRÍTICO: NÃO criar overlay para iframes invisíveis ou inválidos
      if (originalWidth < 10 || originalHeight < 10 || isNaN(aspectRatio) || !isFinite(aspectRatio)) {
        console.log(\`⚠️ [Editor] Iframe ignorado - dimensões inválidas: \${originalWidth}x\${originalHeight} (aspect: \${aspectRatio})\`);
        return; // Pular este iframe
      }

      // Verificar se iframe está oculto via CSS
      if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden' || computedStyle.opacity === '0') {
        console.log(\`⚠️ [Editor] Iframe ignorado - está oculto via CSS\`);
        return;
      }

      // Salvar dimensões originais como data attributes
      iframe.setAttribute('data-cp-original-width', originalWidth.toString());
      iframe.setAttribute('data-cp-original-height', originalHeight.toString());
      iframe.setAttribute('data-cp-aspect-ratio', aspectRatio.toString());

      console.log(\`📐 [Editor] Dimensões originais capturadas: \${originalWidth}x\${originalHeight} (aspect: \${aspectRatio.toFixed(2)})\`);

      // 🚨 CRÍTICO: Verificar se é um iframe "container principal" (muito grande)
      // Iframes que ocupam mais de 80% da viewport provavelmente são containers de preview
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const isLargeContainer = (originalWidth > viewportWidth * 0.8) && (originalHeight > viewportHeight * 0.7);
      
      if (isLargeContainer && !isVideo) {
        console.log(\`⚠️ [Editor] Iframe GRANDE detectado (\${originalWidth}x\${originalHeight}) - NÃO bloqueando (provavelmente container de preview)\`);
        iframe.setAttribute('data-cp-preview-container', 'true');
        // NÃO aplicar pointer-events: none - deixar interação normal
      } else if (isVideo) {
        // 🎬 BLOQUEAR iframes de vídeo (detectados por isVideoElement)
        iframe.setAttribute('data-cp-iframe-protected', 'true');
        iframe.style.pointerEvents = 'none'; // Bloquear interação do iframe
        
        // 🛡️ Remover autoplay da URL do iframe
        try {
          let src = iframe.src || iframe.getAttribute('src') || '';
          if (src && (src.includes('autoplay=1') || src.includes('autoplay=true'))) {
            src = src.replace(/[?&]autoplay=(1|true)/gi, '');
            src = src.replace(/[?&]auto_play=(1|true)/gi, '');
            if (iframe.src) {
              iframe.src = src;
            } else {
              iframe.setAttribute('src', src);
            }
            console.log('🛡️ [Editor] Autoplay removido do iframe de vídeo');
          }
        } catch (e) {
          console.warn('⚠️ [Editor] Erro ao remover autoplay:', e);
        }

        // 🎯 CRIAR OVERLAY para capturar cliques no iframe
        const overlay = document.createElement('div');
        overlay.className = 'cp-iframe-overlay';
        overlay.setAttribute('data-cp-video-iframe-id', iframe.id || 'video-' + Date.now());
        overlay.style.cssText = \`
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 999999;
          cursor: pointer;
          background: transparent;
        \`;

        // Verificar se o iframe já tem wrapper
        const parent = iframe.parentElement;
        if (parent && parent.style.position !== 'relative' && parent.style.position !== 'absolute' && parent.style.position !== 'fixed') {
          parent.style.position = 'relative';
        }

        // Inserir overlay após o iframe (não como irmão, mas no mesmo nível)
        if (parent) {
          parent.appendChild(overlay);
          iframe.setAttribute('data-cp-overlay-added', 'true');
          console.log('🎯 [Editor] Overlay criado para iframe de vídeo');
        }
        
        const iframeSrc = (iframe.src || iframe.getAttribute('data-src') || '').substring(0, 80);
        const iframeClass = iframe.className || '(sem classe)';
        console.log(\`✅ [Editor] Iframe de VÍDEO bloqueado - Classe: \${iframeClass} | Src: \${iframeSrc}...\`);
      } else {
        // Iframe pequeno/médio não reconhecido - marcar mas não bloquear completamente
        iframe.setAttribute('data-cp-iframe-other', 'true');
        const iframeSrc = (iframe.src || iframe.getAttribute('data-src') || '').substring(0, 50);
        console.log(\`ℹ️ [Editor] Iframe não-vídeo detectado, mantendo interação: \${iframeSrc}...\`);
      }
    });

    // 2️⃣ Bloquear tags HTML5 <video> com overlay e eventos
    document.querySelectorAll('video').forEach(function(video) {
      if (video.hasAttribute('data-cp-video-blocked')) return; // Já bloqueado

      console.log('🎬 [Editor] Vídeo HTML5 detectado, bloqueando interação', video);

      // ✅ CRÍTICO: Capturar dimensões ANTES de modificar
      const videoRect = video.getBoundingClientRect();
      const originalWidth = videoRect.width;
      const originalHeight = videoRect.height;
      const aspectRatio = originalWidth / originalHeight;

      // 🚨 CRÍTICO: NÃO criar overlay para vídeos invisíveis ou inválidos
      if (originalWidth < 10 || originalHeight < 10 || isNaN(aspectRatio) || !isFinite(aspectRatio)) {
        console.log(\`⚠️ [Editor] Vídeo ignorado - dimensões inválidas: \${originalWidth}x\${originalHeight} (aspect: \${aspectRatio})\`);
        return; // Pular este vídeo
      }

      const computedStyle = window.getComputedStyle(video);
      if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden' || computedStyle.opacity === '0') {
        console.log(\`⚠️ [Editor] Vídeo ignorado - está oculto via CSS\`);
        return;
      }

      video.setAttribute('data-cp-original-width', originalWidth.toString());
      video.setAttribute('data-cp-original-height', originalHeight.toString());
      video.setAttribute('data-cp-aspect-ratio', aspectRatio.toString());

      console.log(\`📐 [Editor] Dimensões do vídeo capturadas: \${originalWidth}x\${originalHeight} (aspect: \${aspectRatio.toFixed(2)})\`);

      // Pausar o vídeo se estiver tocando
      if (!video.paused) {
        video.pause();
      }

      // Bloquear todos os controles
      video.setAttribute('data-cp-original-controls', video.controls);
      video.controls = false;

      // Prevenir play
      video.addEventListener('play', function(e) {
        console.log('🛡️ [Editor] Bloqueando play de vídeo HTML5');
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        video.pause();
      }, true);

      // 🚨 NOVA ABORDAGEM: Não criar overlay, apenas marcar o vídeo
      video.setAttribute('data-cp-video-protected', 'true');
      video.style.pointerEvents = 'none'; // Bloquear interação do vídeo
      video.setAttribute('data-cp-video-blocked', 'true');
      
      console.log('✅ [Editor] Vídeo protegido sem overlay');
    });

    console.log('✅ [Editor] Bloqueio de vídeos concluído');

    console.log('✅ [Editor] Elementos preparados para edição');

    // ============================================
    // 🎬 OBSERVAR VÍDEOS DINÂMICOS (Elementor, etc)
    // ============================================
    console.log('🔍 [Editor] Iniciando observação de vídeos dinâmicos...');

    const dynamicVideoObserver = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        // Verificar novos nós adicionados
        mutation.addedNodes.forEach(function(node) {
          // Ignorar nós de texto
          if (node.nodeType !== 1) return;

          // 1️⃣ Verificar se o nó adicionado é um iframe
          if (node.tagName === 'IFRAME') {
            processNewIframe(node);
          }

          // 2️⃣ Verificar se o nó adicionado contém iframes
          if (node.querySelectorAll) {
            const iframes = node.querySelectorAll('iframe');
            iframes.forEach(function(iframe) {
              processNewIframe(iframe);
            });
          }

          // 3️⃣ Verificar se o nó adicionado é um vídeo HTML5
          if (node.tagName === 'VIDEO') {
            processNewVideo(node);
          }

          // 4️⃣ Verificar se o nó adicionado contém vídeos HTML5
          if (node.querySelectorAll) {
            const videos = node.querySelectorAll('video');
            videos.forEach(function(video) {
              processNewVideo(video);
            });
          }
        });
      });
    });

    // Função para processar novo iframe
    function processNewIframe(iframe) {
      if (iframe.hasAttribute('data-cp-overlay-added')) return; // Já processado

      const isVideo = isVideoElement(iframe);
      const isYouTube = (iframe.src || '').includes('youtube.com') ||
                       (iframe.getAttribute('data-src') || '').includes('youtube.com');

      console.log(\`🎬 [Editor] NOVO iframe detectado dinamicamente - É vídeo: \${isVideo} | YouTube: \${isYouTube}\`, iframe.src || iframe.getAttribute('data-src'));

      // ✅ CRÍTICO: Capturar dimensões ANTES de qualquer modificação
      const iframeRect = iframe.getBoundingClientRect();
      const originalWidth = iframeRect.width;
      const originalHeight = iframeRect.height;
      const aspectRatio = originalWidth / originalHeight;

      iframe.setAttribute('data-cp-original-width', originalWidth.toString());
      iframe.setAttribute('data-cp-original-height', originalHeight.toString());
      iframe.setAttribute('data-cp-aspect-ratio', aspectRatio.toString());

      console.log(\`📐 [Editor] Dimensões do NOVO iframe capturadas: \${originalWidth}x\${originalHeight} (aspect: \${aspectRatio.toFixed(2)})\`);

      // 🛡️ PREPARAÇÃO UNIVERSAL para novos iframes do YouTube
      if (isYouTube && !iframe.hasAttribute('data-cp-youtube-prepared')) {
        try {
          prepareUniversalYouTubeIframe(iframe);
          iframe.setAttribute('data-cp-youtube-prepared', 'true');
          console.log('🎬 [Editor] NOVO iframe YouTube preparado universalmente');
        } catch (e) {
          console.warn('⚠️ [Editor] Erro ao preparar novo iframe YouTube:', e.message);
        }
      }

      // Criar overlay
      const overlay = document.createElement('div');
      overlay.className = 'cp-iframe-overlay';
      if (isVideo) {
        overlay.classList.add('cp-video-overlay');
        if (isYouTube) {
          overlay.classList.add('cp-youtube-overlay');
        }
      }
      overlay.setAttribute('data-cp-iframe-id', iframe.id || 'iframe-' + Date.now());

      // Inserir overlay
      if (iframe.parentElement) {
        const parent = iframe.parentElement;
        const parentPosition = window.getComputedStyle(parent).position;

        // ✅ MELHORADO: Preservar dimensões ao mudar position
        if (parentPosition === 'static') {
          parent.setAttribute('data-cp-original-position', 'static');
          parent.style.position = 'relative';

          // ✅ NOVO: Forçar dimensões do iframe após mudança de position
          iframe.style.width = originalWidth + 'px';
          iframe.style.height = originalHeight + 'px';
          iframe.style.maxWidth = '100%';
          iframe.style.aspectRatio = aspectRatio.toString();

          console.log('✅ [Editor] Dimensões do NOVO iframe forçadas após mudança de position');
        }

        parent.appendChild(overlay);
        iframe.setAttribute('data-cp-overlay-added', 'true');

        // Handler de click
        overlay.addEventListener('click', function(e) {
          e.preventDefault();
          console.log('🎯 [Editor] Click em overlay de iframe dinâmico');
          const clickEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
          });
          iframe.dispatchEvent(clickEvent);
        }, false);
      }
    }

    // Função para processar novo vídeo HTML5
    function processNewVideo(video) {
      if (video.hasAttribute('data-cp-video-blocked')) return; // Já processado

      console.log('🎬 [Editor] NOVO vídeo HTML5 detectado dinamicamente', video);

      // Pausar se estiver tocando
      if (!video.paused) {
        video.pause();
      }

      // Bloquear controles
      video.setAttribute('data-cp-original-controls', video.controls);
      video.controls = false;

      // Prevenir play
      video.addEventListener('play', function(e) {
        console.log('🛡️ [Editor] Bloqueando play de vídeo HTML5 dinâmico');
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        video.pause();
      }, true);

      // Criar overlay
      const overlay = document.createElement('div');
      overlay.className = 'cp-iframe-overlay cp-video-overlay';
      overlay.setAttribute('data-cp-video-id', video.id || 'video-' + Date.now());

      if (video.parentElement) {
        const parent = video.parentElement;
        const parentPosition = window.getComputedStyle(parent).position;
        if (parentPosition === 'static') {
          parent.setAttribute('data-cp-original-position', 'static');
          parent.style.position = 'relative';
        }
        parent.appendChild(overlay);
        video.setAttribute('data-cp-video-blocked', 'true');

        overlay.addEventListener('click', function(e) {
          e.preventDefault();
          console.log('🎯 [Editor] Click em overlay de vídeo dinâmico');
          const clickEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
          });
          video.dispatchEvent(clickEvent);
        }, false);
      }
    }

    // Iniciar observação do DOM
    dynamicVideoObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('✅ [Editor] Observação de vídeos dinâmicos ativada');
  }

  document.addEventListener('DOMContentLoaded', prepareInteractiveElements);

  // Executar imediatamente também (caso DOM já esteja pronto)
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    prepareInteractiveElements();
  }

  // ❌ REMOVIDO: setInterval que causava reflows a cada 1 segundo
  // ✅ SOLUÇÃO: Confiar apenas no MutationObserver para elementos dinâmicos
  // setInterval(prepareInteractiveElements, 1000);

  // Adicionar estilos
  const style = document.createElement('style');
  style.id = 'cp-editor-style';
  style.setAttribute('data-tuglet', 'true');
  style.textContent = \`
    /* ========================================
       ESTILOS DE SELEÇÃO DO EDITOR
       ======================================== */
    .cp-hover-highlight {
      outline: 2px dashed #4A90E2 !important;
      cursor: pointer !important;
      z-index: 999999 !important;
    }
    /* Iframes e vídeos não devem mudar position no hover */
    iframe.cp-hover-highlight,
    video.cp-hover-highlight {
      outline: 2px dashed #4A90E2 !important;
      cursor: pointer !important;
      z-index: 999999 !important;
    }
    .cp-selected {
      outline: 3px solid #4A90E2 !important;
      z-index: 999999 !important;
    }
    /* Iframes selecionados não devem mudar position para preservar proporção */
    iframe.cp-selected,
    video.cp-selected {
      outline: 3px solid #4A90E2 !important;
      z-index: 999999 !important;
    }

    /* ========================================
       MODO EDIÇÃO - Cursor pointer em tudo
       ======================================== */
    body.cp-edit-mode * {
      cursor: pointer !important;
    }

    /* ========================================
       PROTEÇÃO DE IFRAMES E VÍDEOS
       Sem overlays - bloqueio direto via pointer-events
       ======================================== */
    iframe[data-cp-iframe-protected],
    video[data-cp-video-protected] {
      pointer-events: none !important; /* Bloquear interação direta */
    }
    
    /* ✅ PERMITIR SCROLL no modo edição */
    body.cp-edit-mode {
      overflow: auto !important; /* Permitir scroll */
      overflow-x: auto !important;
      overflow-y: auto !important;
    }

    /* ========================================
       OVERLAY PARA VÍDEOS - Indicador visual
       ======================================== */
    .cp-iframe-overlay {
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      width: 100% !important;
      height: 100% !important;
      z-index: 999999 !important;
      cursor: pointer !important;
      background: rgba(255, 255, 255, 0.02) !important;
      transition: background 0.3s ease !important;
      pointer-events: auto !important;
    }

    .cp-iframe-overlay:hover {
      background: rgba(74, 144, 226, 0.1) !important;
    }

    .cp-iframe-overlay::before {
      content: '🎬 Vídeo' !important;
      position: absolute !important;
      top: 10px !important;
      right: 10px !important;
      font-size: 14px !important;
      background: rgba(0, 0, 0, 0.7) !important;
      color: white !important;
      padding: 5px 10px !important;
      border-radius: 4px !important;
      opacity: 0.3 !important;
      pointer-events: none !important;
    }

    .cp-iframe-overlay:hover::before {
      opacity: 0.8 !important;
    }

    .cp-video-overlay {
      background: rgba(255, 255, 255, 0.02) !important;
      transition: background 0.3s ease !important;
    }

    .cp-video-overlay:hover {
      background: rgba(74, 144, 226, 0.1) !important;
    }

    /* ========================================
       🔲 RESIZE HANDLES - Redimensionamento Visual
       ======================================== */
    .cp-resize-handle {
      position: absolute !important;
      width: 10px !important;
      height: 10px !important;
      background: #667eea !important;
      border: 2px solid white !important;
      border-radius: 50% !important;
      z-index: 99999999 !important;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3) !important;
      transition: all 0.2s ease !important;
      pointer-events: auto !important;
    }

    .cp-resize-handle:hover {
      background: #4A90E2 !important;
      transform: scale(1.3) !important;
      box-shadow: 0 3px 10px rgba(74, 144, 226, 0.5) !important;
    }

    .cp-resize-handle:active {
      background: #2E5C8A !important;
      transform: scale(1.1) !important;
    }

    /* Cursores específicos para cada direção */
    .cp-resize-n, .cp-resize-s {
      cursor: ns-resize !important;
    }

    .cp-resize-e, .cp-resize-w {
      cursor: ew-resize !important;
    }

    .cp-resize-ne, .cp-resize-sw {
      cursor: nesw-resize !important;
    }

    .cp-resize-nw, .cp-resize-se {
      cursor: nwse-resize !important;
    }

    /* Indicador visual durante resize */
    .cp-resizing {
      outline: 3px solid #4A90E2 !important;
      opacity: 0.8 !important;
      transition: none !important;
    }

    /* Container de resize (wrapper) */
    .cp-resize-container {
      position: relative !important;
    }

    /* ========================================
       📱 AJUSTE AUTOMÁTICO MOBILE - Prevenção de Overflow
       ======================================== */
    @media (max-width: 768px) {
      /* Elementos de mídia que frequentemente causam overflow */
      img, video, iframe, embed, object {
        max-width: 100% !important;
        height: auto !important;
      }
      
      /* Prevenir overflow horizontal em body e html */
      html, body {
        overflow-x: hidden !important;
        max-width: 100vw !important;
      }
      
      /* Containers principais */
      body > * {
        max-width: 100vw !important;
      }
    }

    .cp-video-overlay::before {
      content: '🎬' !important;
      position: absolute !important;
      top: 10px !important;
      right: 10px !important;
      font-size: 24px !important;
      opacity: 0 !important;
      transition: opacity 0.3s ease !important;
      pointer-events: none !important;
      z-index: 999999 !important;
    }

    .cp-video-overlay:hover::before {
      opacity: 0.6 !important;
    }

    /* 🎬 ESTILOS ESPECÍFICOS PARA YOUTUBE */
    .cp-youtube-overlay {
      background: rgba(255, 0, 0, 0.05) !important;
      border: 1px dashed rgba(255, 0, 0, 0.2) !important;
    }

    .cp-youtube-overlay:hover {
      background: rgba(255, 0, 0, 0.15) !important;
      border-color: rgba(255, 0, 0, 0.4) !important;
    }

    .cp-youtube-overlay::before {
      content: '▶️ YOUTUBE' !important;
      position: absolute !important;
      top: 8px !important;
      left: 8px !important;
      font-size: 14px !important;
      opacity: 0.8 !important;
      transition: opacity 0.3s ease !important;
      pointer-events: none !important;
      z-index: 999999 !important;
      background: rgba(0, 0, 0, 0.7) !important;
      color: white !important;
      padding: 4px 8px !important;
      border-radius: 4px !important;
      font-weight: bold !important;
    }

    .cp-youtube-overlay:hover::before {
      opacity: 1 !important;
    }

    /* 🛡️ PREVENIR ERROS 153: Iframes do YouTube com compatibilidade cross-origin */
    iframe[data-cp-youtube-prepared] {
      box-shadow: 0 0 0 2px rgba(255, 0, 0, 0.3) !important;
      transition: box-shadow 0.3s ease !important;
    }

    iframe[data-cp-youtube-prepared]:hover {
      box-shadow: 0 0 0 3px rgba(255, 0, 0, 0.5) !important;
    }

    /* Desabilitar controles de vídeo visualmente */
    body.cp-edit-mode video::-webkit-media-controls,
    body.cp-edit-mode audio::-webkit-media-controls {
      display: none !important;
    }

    body.cp-edit-mode video::-webkit-media-controls-enclosure,
    body.cp-edit-mode audio::-webkit-media-controls-enclosure {
      display: none !important;
    }

    /* ========================================
       🎬 KEYFRAMES DAS ANIMAÇÕES (para funcionar no modo edição)
       ======================================== */

    /* 🎯 Pulse - Para badges e elementos importantes */
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.05); opacity: 0.8; }
    }

    /* ⬆️ Bounce - Animação de pulo */
    @keyframes bounce {
      0%, 20%, 53%, 80%, 100% { transform: translate3d(0, 0, 0); }
      40%, 43% { transform: translate3d(0, -15px, 0); }
      70% { transform: translate3d(0, -7px, 0); }
      90% { transform: translate3d(0, -3px, 0); }
    }

    /* 🤝 Shake - Animação de tremida */
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
      20%, 40%, 60%, 80% { transform: translateX(5px); }
    }

    /* 👻 Fade In - Aparecer suavemente */
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* ⬅️ Slide In Left - Entrar pela esquerda */
    @keyframes slideInLeft {
      from { opacity: 0; transform: translateX(-100%); }
      to { opacity: 1; transform: translateX(0); }
    }

    /* ➡️ Slide In Right - Entrar pela direita */
    @keyframes slideInRight {
      from { opacity: 0; transform: translateX(100%); }
      to { opacity: 1; transform: translateX(0); }
    }

    /* 🔍 Zoom In - Aumentar escala */
    @keyframes zoomIn {
      from { opacity: 0; transform: scale(0.3); }
      50% { opacity: 1; transform: scale(1.05); }
      100% { opacity: 1; transform: scale(1); }
    }

    /* 🔄 Rotate - Rotação contínua */
    @keyframes rotate {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    /* 🎈 Float - Flutuar suavemente */
    @keyframes float {
      0%, 100% { transform: translateY(0px); }
      50% { transform: translateY(-10px); }
    }

    /* 🎯 ANIMAÇÕES COM IMPORTÂNCIA MÁXIMA para garantir funcionamento */
    .cp-animation-pulse {
      animation: pulse 2s ease-in-out infinite !important;
    }
    .cp-animation-bounce {
      animation: bounce 2s ease-in-out infinite !important;
    }
    .cp-animation-shake {
      animation: shake 2s ease-in-out infinite !important;
    }
    .cp-animation-fadeIn {
      animation: fadeIn 2s ease-in-out infinite !important;
    }
    .cp-animation-slideInLeft {
      animation: slideInLeft 2s ease-in-out infinite !important;
    }
    .cp-animation-slideInRight {
      animation: slideInRight 2s ease-in-out infinite !important;
    }
    .cp-animation-zoomIn {
      animation: zoomIn 2s ease-in-out infinite !important;
    }
    .cp-animation-rotate {
      animation: rotate 2s linear infinite !important;
    }
    .cp-animation-float {
      animation: float 3s ease-in-out infinite !important;
    }
  \`;
  document.head.appendChild(style);
  document.body.classList.add('cp-edit-mode');

  console.log('✅ [Editor] CSS de bloqueio aplicado');

  // ============================================
  // 🔲 RESIZE HANDLES - Funções de Redimensionamento
  // ============================================

  /**
   * Adiciona handles de redimensionamento ao elemento selecionado
   */
  function addResizeHandles(element) {
    console.log('🔲 [Resize] Adicionando handles ao elemento:', element.tagName);
    
    // Verificar se elemento pode ser redimensionado
    const cannotResize = ['HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE'].includes(element.tagName);
    if (cannotResize) {
      console.log('🔲 [Resize] Elemento não pode ser redimensionado:', element.tagName);
      return;
    }
    
    // Remover handles antigos
    removeResizeHandles();
    
    // Obter posição e tamanho do elemento
    const rect = element.getBoundingClientRect();
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;
    
    // Criar container wrapper para os handles
    const wrapper = document.createElement('div');
    wrapper.className = 'cp-resize-wrapper';
    wrapper.setAttribute('data-cp-resize-wrapper', 'true');
    wrapper.style.cssText = \`
      position: absolute !important;
      top: \${rect.top + scrollY}px !important;
      left: \${rect.left + scrollX}px !important;
      width: \${rect.width}px !important;
      height: \${rect.height}px !important;
      pointer-events: none !important;
      z-index: 99999998 !important;
    \`;
    
    // Armazenar referência ao elemento sendo redimensionado
    wrapper._cpTargetElement = element;
    
    // Posições dos 8 handles
    const positions = [
      { name: 'n', cursor: 'ns-resize', top: '-5px', left: '50%', transform: 'translateX(-50%)' },
      { name: 'ne', cursor: 'nesw-resize', top: '-5px', right: '-5px' },
      { name: 'e', cursor: 'ew-resize', top: '50%', right: '-5px', transform: 'translateY(-50%)' },
      { name: 'se', cursor: 'nwse-resize', bottom: '-5px', right: '-5px' },
      { name: 's', cursor: 'ns-resize', bottom: '-5px', left: '50%', transform: 'translateX(-50%)' },
      { name: 'sw', cursor: 'nesw-resize', bottom: '-5px', left: '-5px' },
      { name: 'w', cursor: 'ew-resize', top: '50%', left: '-5px', transform: 'translateY(-50%)' },
      { name: 'nw', cursor: 'nwse-resize', top: '-5px', left: '-5px' }
    ];
    
    positions.forEach(function(pos) {
      const handle = document.createElement('div');
      handle.className = 'cp-resize-handle cp-resize-' + pos.name;
      handle.setAttribute('data-direction', pos.name);
      handle.style.cssText = \`
        \${pos.top ? 'top: ' + pos.top + ' !important;' : ''}
        \${pos.right ? 'right: ' + pos.right + ' !important;' : ''}
        \${pos.bottom ? 'bottom: ' + pos.bottom + ' !important;' : ''}
        \${pos.left ? 'left: ' + pos.left + ' !important;' : ''}
        \${pos.transform ? 'transform: ' + pos.transform + ' !important;' : ''}
      \`;
      
      handle.addEventListener('mousedown', function(e) {
        startResize(e, element, pos.name, wrapper);
      });
      
      wrapper.appendChild(handle);
    });
    
    document.body.appendChild(wrapper);
    console.log('🔲 [Resize] Handles adicionados com sucesso');
  }

  /**
   * Remove todos os resize handles
   */
  function removeResizeHandles() {
    const oldWrappers = document.querySelectorAll('[data-cp-resize-wrapper]');
    oldWrappers.forEach(function(wrapper) {
      wrapper.remove();
    });
  }

  /**
   * Atualiza posição dos resize handles quando elemento muda
   */
  function updateResizeHandlesPosition(element) {
    const wrapper = document.querySelector('[data-cp-resize-wrapper]');
    if (!wrapper || !element) return;
    
    const rect = element.getBoundingClientRect();
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;
    
    wrapper.style.top = (rect.top + scrollY) + 'px';
    wrapper.style.left = (rect.left + scrollX) + 'px';
    wrapper.style.width = rect.width + 'px';
    wrapper.style.height = rect.height + 'px';
  }

  /**
   * Inicia o redimensionamento do elemento
   */
  function startResize(e, element, direction, wrapper) {
    e.preventDefault();
    e.stopPropagation();
    
    console.log('🔲 [Resize] Iniciando resize na direção:', direction, 'viewport:', currentEditorViewport);
    
    element.classList.add('cp-resizing');
    
    var savedInlineWidth = element.style.width || '';
    var savedInlineHeight = element.style.height || '';
    
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = element.offsetWidth;
    const startHeight = element.offsetHeight;
    const computedStyle = window.getComputedStyle(element);
    
    const originalWidth = computedStyle.width;
    const originalHeight = computedStyle.height;
    
    console.log('🔲 [Resize] Valores iniciais:', {
      width: startWidth,
      height: startHeight,
      direction: direction
    });
    
    function onMouseMove(moveE) {
      const deltaX = moveE.clientX - startX;
      const deltaY = moveE.clientY - startY;
      
      let newWidth = startWidth;
      let newHeight = startHeight;
      
      if (direction.includes('e')) {
        newWidth = Math.max(20, startWidth + deltaX);
      }
      if (direction.includes('w')) {
        newWidth = Math.max(20, startWidth - deltaX);
      }
      if (direction.includes('s')) {
        newHeight = Math.max(20, startHeight + deltaY);
      }
      if (direction.includes('n')) {
        newHeight = Math.max(20, startHeight - deltaY);
      }
      
      if (direction.includes('e') || direction.includes('w')) {
        element.style.width = newWidth + 'px';
        if (currentEditorViewport === 'desktop') {
          applyMobileAutoFix(element, 'width', newWidth + 'px');
        }
      }
      if (direction.includes('n') || direction.includes('s')) {
        element.style.height = newHeight + 'px';
        if (currentEditorViewport === 'desktop') {
          applyMobileAutoFix(element, 'height', newHeight + 'px');
        }
      }
      
      updateResizeHandlesPosition(element);
    }
    
    function onMouseUp() {
      console.log('🔲 [Resize] Resize finalizado, viewport:', currentEditorViewport);
      
      element.classList.remove('cp-resizing');
      
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      
      var finalWidth = element.style.width || (element.offsetWidth + 'px');
      var finalHeight = element.style.height || (element.offsetHeight + 'px');
      
      if (currentEditorViewport === 'mobile') {
        try {
          applyResponsiveMobileOverride(element, 'width', finalWidth);
          applyResponsiveMobileOverride(element, 'height', finalHeight);
          element.style.width = savedInlineWidth;
          element.style.height = savedInlineHeight;
          console.log('🔲 [Resize] Aplicado ao mobile (overrides), inline restaurado');
        } catch (err) {
          console.warn('🔲 [Resize] Fallback mobile:', err);
          element.style.width = finalWidth;
          element.style.height = finalHeight;
        }
      } else {
        try {
          removeResponsiveMobileOverrideForProperty(element, 'width');
          removeResponsiveMobileOverrideForProperty(element, 'height');
          applyMobileAutoFix(element, 'width', finalWidth);
          applyMobileAutoFix(element, 'height', finalHeight);
        } catch (err) {
          console.warn('🔲 [Resize] remove/applyMobileAutoFix ignorado:', err);
        }
      }
      
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          source: 'EDITOR_IFRAME',
          type: 'ELEMENT_UPDATED'
        }, '*');
      }
      
      console.log('🔲 [Resize] Novos valores:', {
        width: element.style.width,
        height: element.style.height
      });
    }
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  // Mouse hover - Melhorado para detectar TODOS os elementos incluindo divs
  document.addEventListener('mouseover', function(e) {
    let target = e.target;

    // Ignorar text nodes
    if (!target || target.nodeType === 3) {
      if (target && target.parentElement) {
        target = target.parentElement;
      } else {
        return;
      }
    }

    // Ignorar body, html e elementos do editor
    if (!target || 
        target === document.body || 
        target === document.documentElement ||
        (target.classList && (
          target.id === 'cp-editor-script' ||
          target.id === 'cp-protection-script' ||
          target.id === 'cp-editor-style'
        ))) {
      return;
    }

    // Remover highlight do elemento anterior
    if (hoveredElement && hoveredElement !== selectedElement && hoveredElement.classList) {
      hoveredElement.classList.remove(HIGHLIGHT_CLASS);
    }

    // Adicionar highlight ao novo elemento (se não for o selecionado)
    if (target !== selectedElement && target.classList) {
      hoveredElement = target;
      try {
        hoveredElement.classList.add(HIGHLIGHT_CLASS);
        console.log('🎯 [Editor] Hover em:', target.tagName, target.className || '(sem classe)');
      } catch (err) {
        console.warn('⚠️ [Editor] Erro ao adicionar classe de hover:', err);
      }
    }
  }, true); // Use capture phase para garantir que captura antes de outros listeners

  // Mouseout - Remover highlight quando sair do elemento
  document.addEventListener('mouseout', function(e) {
    let target = e.target;

    // Ignorar elementos de texto
    if (!target || target.nodeType === 3) {
      return;
    }

    // Se o target é um elemento de texto, usar o elemento pai
    if (target.nodeType === 3 && target.parentElement) {
      target = target.parentElement;
    }

    // Se o mouse saiu do elemento que estava em hover (e não é o selecionado)
    if (hoveredElement && hoveredElement === target && hoveredElement !== selectedElement && hoveredElement.classList) {
      hoveredElement.classList.remove(HIGHLIGHT_CLASS);
      hoveredElement = null;
    }
  }, true);

  // Click handler para SELEÇÃO
  document.addEventListener('click', function(e) {
    console.log('🎯 [Editor] Click handler de seleção ativado');

    // Marcar que o editor está processando o evento
    editorClickProcessed = false;

    let target = e.target;
    let isOverlayClick = false;

    // Se clicou no overlay de iframe ou vídeo, selecionar o elemento real
    if (target.classList && target.classList.contains('cp-iframe-overlay')) {
      console.log('🎯 [Editor] Click detectado em overlay');
      isOverlayClick = true;
      const parent = target.parentElement;

      // Tentar encontrar iframe primeiro
      let iframe = parent ? parent.querySelector('iframe') : null;
      if (iframe) {
        console.log('🎯 [Editor] Selecionando iframe através do overlay');
        target = iframe;
      } else {
        // Se não encontrou iframe, tentar encontrar vídeo HTML5
        let video = parent ? parent.querySelector('video') : null;
        if (video) {
          console.log('🎬 [Editor] Selecionando vídeo HTML5 através do overlay');
          target = video;
        } else {
          console.warn('⚠️ [Editor] Elemento de mídia não encontrado para overlay');
          editorClickProcessed = true;
          return;
        }
      }
    }

    if (!target || target === document.body) {
      editorClickProcessed = true;
      return;
    }

    // 🎯 NOVO: Se clicou em elemento dentro de link, selecionar o link pai
    let actualTarget = target;
    const closestLink = target.closest('a');
    if (closestLink && target.tagName !== 'A') {
      console.log('🔗 [Editor] Click em elemento dentro de link, selecionando o link pai');
      actualTarget = closestLink;
    }

    console.log('🎯 [Editor] Selecionando elemento:', {
      tagName: actualTarget.tagName,
      id: actualTarget.id || '(sem id)',
      className: actualTarget.className || '(sem classe)',
      viaOverlay: isOverlayClick,
      isLink: actualTarget.tagName === 'A'
    });

    // 🎯 Remover seleção anterior de forma robusta
    document.querySelectorAll('.' + SELECTED_CLASS).forEach(function(el) {
      el.classList.remove(SELECTED_CLASS);
    });

    // 🔲 Remover resize handles anteriores
    removeResizeHandles();

    // 🎯 Remover também do hover se estava no mesmo elemento
    if (hoveredElement && hoveredElement.classList.contains(HIGHLIGHT_CLASS)) {
      hoveredElement.classList.remove(HIGHLIGHT_CLASS);
    }

    // 🎯 Selecionar novo elemento
    selectedElement = actualTarget;
    try {
      selectedElement.classList.add(SELECTED_CLASS);
      console.log('✅ [Editor] Classe de seleção adicionada ao elemento');
    } catch (err) {
      console.warn('⚠️ Erro ao adicionar classe ao elemento:', err);
    }

    if (window.parent && window.parent !== window) {
      // 🎯 Coletar dados do elemento selecionado
      try {
        const elementData = {
          xpath: getXPathForElement(actualTarget),
          tagName: actualTarget.tagName,
          textContent: actualTarget.textContent?.substring(0, 100),
          className: actualTarget.className || '',
          id: actualTarget.id || '',
        };

        // 🎬 Detectar se é um vídeo
        const isVideo = isVideoElement(actualTarget);
        if (isVideo) {
          elementData.isVideo = true;
          console.log('🎬 [Editor] Elemento selecionado é um VÍDEO!', {
            tag: actualTarget.tagName,
            src: actualTarget.src || actualTarget.getAttribute('src') || 'N/A'
          });
        }

        // 🎠 Detectar se é um slider/carousel
        const sliderInfo = detectSliderType(actualTarget);
        if (sliderInfo) {
          elementData.isSlider = true;
          elementData.sliderInfo = sliderInfo;
          console.log('🎠 [Editor] Elemento selecionado é um SLIDER!', {
            type: sliderInfo.type,
            hasInstance: sliderInfo.hasInstance,
            config: sliderInfo.config
          });
        }

        // 🎨 COLETAR ESTILOS COMPUTADOS DO ELEMENTO
        try {
          const computedStyle = window.getComputedStyle(actualTarget);
          elementData.styles = {
            // Cores
            backgroundColor: computedStyle.backgroundColor || '',
            color: computedStyle.color || '',
            borderColor: computedStyle.borderColor || '',
            
            // Dimensões
            width: computedStyle.width || '',
            height: computedStyle.height || '',
            padding: computedStyle.padding || '',
            margin: computedStyle.margin || '',
            
            // Bordas
            borderRadius: computedStyle.borderRadius || '',
            borderWidth: computedStyle.borderWidth || '',
            borderStyle: computedStyle.borderStyle || '',
            
            // Efeitos
            boxShadow: computedStyle.boxShadow || '',
            textShadow: computedStyle.textShadow || '',
            opacity: computedStyle.opacity || '',
            filter: computedStyle.filter || '',
            transform: computedStyle.transform || '',
            
            // Texto
            fontSize: computedStyle.fontSize || '',
            fontWeight: computedStyle.fontWeight || '',
            fontStyle: computedStyle.fontStyle || '',
            textAlign: computedStyle.textAlign || '',
            textDecoration: computedStyle.textDecoration || '',
            
            // Background
            backgroundImage: computedStyle.backgroundImage || '',
            backgroundSize: computedStyle.backgroundSize || '',
            backgroundPosition: computedStyle.backgroundPosition || '',
          };
          console.log('🎨 [Editor] Estilos computados coletados:', {
            bgColor: elementData.styles.backgroundColor,
            color: elementData.styles.color,
            width: elementData.styles.width,
            height: elementData.styles.height
          });
        } catch (e) {
          console.warn('⚠️ [Editor] Erro ao coletar estilos computados:', e);
          // Fallback com estilos vazios
          elementData.styles = {
            backgroundColor: '', color: '', borderColor: '',
            width: '', height: '', padding: '', margin: '',
            borderRadius: '', borderWidth: '', borderStyle: '',
            boxShadow: '', textShadow: '', opacity: '', filter: '', transform: '',
            fontSize: '', fontWeight: '', fontStyle: '', textAlign: '', textDecoration: '',
            backgroundImage: '', backgroundSize: '', backgroundPosition: '',
          };
        }

        // 📦 COLETAR ATRIBUTOS DO ELEMENTO
        try {
          elementData.attributes = {};
          if (actualTarget.attributes) {
            for (let i = 0; i < actualTarget.attributes.length; i++) {
              const attr = actualTarget.attributes[i];
              elementData.attributes[attr.name] = attr.value;
            }
          }
          console.log('📦 [Editor] Atributos coletados:', Object.keys(elementData.attributes).length);
        } catch (e) {
          console.warn('⚠️ [Editor] Erro ao coletar atributos:', e);
          elementData.attributes = {};
        }

        // Acessar propriedades de forma segura com try-catch
        try {
          if (actualTarget.src) elementData.src = actualTarget.src;
        } catch (e) {}

        // 🎯 MELHORADO: Buscar href do próprio elemento OU do link pai
        try {
          let hrefValue = null;

          // Tentar getAttribute primeiro (mais confiável)
          if (actualTarget.getAttribute && actualTarget.getAttribute('href')) {
            hrefValue = actualTarget.getAttribute('href');
          }
          // Fallback para propriedade href
          else if (actualTarget.href && actualTarget.href !== '') {
            hrefValue = actualTarget.href;
          }
          // Se não achou e tem link pai, tentar no link pai
          else if (closestLink) {
            if (closestLink.getAttribute && closestLink.getAttribute('href')) {
              hrefValue = closestLink.getAttribute('href');
            } else if (closestLink.href && closestLink.href !== '') {
              hrefValue = closestLink.href;
            }
          }

          if (hrefValue) {
            elementData.href = hrefValue;
            console.log('🔗 [Editor] Href encontrado:', hrefValue.substring(0, 100));
          }
        } catch (e) {
          console.warn('⚠️ [Editor] Erro ao obter href:', e);
        }

        try {
          if (actualTarget.alt) elementData.alt = actualTarget.alt;
        } catch (e) {}

        // 🎯 NOVO: Detectar e categorizar seção automaticamente (INCLUINDO DIVS)
        try {
          const rect = actualTarget.getBoundingClientRect();
          const isLargeElement = rect.height > 100 || rect.width > 300;
          const isSectionTag = ['HEADER', 'FOOTER', 'SECTION', 'NAV', 'ASIDE', 'MAIN', 'ARTICLE'].includes(actualTarget.tagName);
          const isDivContainer = actualTarget.tagName === 'DIV' && (
            (actualTarget.className || '').includes('section') ||
            (actualTarget.className || '').includes('container') ||
            (actualTarget.className || '').includes('elementor') ||
            (actualTarget.className || '').includes('wp-block') ||
            isLargeElement
          );

          if (isSectionTag || isDivContainer) {
            const tagName = actualTarget.tagName.toLowerCase();
            const className = (actualTarget.className || '').toLowerCase();
            const id = (actualTarget.id || '').toLowerCase();
            const textContent = (actualTarget.textContent || '').toLowerCase().substring(0, 500);

            const scrollY = window.pageYOffset || document.documentElement.scrollTop;
            const docHeight = document.documentElement.scrollHeight;
            const elementTop = rect.top + scrollY;
            const positionPercent = (elementTop / docHeight) * 100;

            const scores = {
              header: 0, hero: 0, features: 0, about: 0, services: 0,
              testimonials: 0, pricing: 0, cta: 0, contact: 0, footer: 0, other: 0
            };

            if (positionPercent < 15) {
              scores.header += 40;
              scores.hero += 30;
            } else if (positionPercent < 30) {
              scores.hero += 40;
            } else if (positionPercent > 85) {
              scores.footer += 40;
            }

            if (tagName === 'header') scores.header += 50;
            if (id.includes('header') || id.includes('nav')) scores.header += 30;
            if (className.includes('header') || className.includes('navbar')) scores.header += 30;

            if (className.includes('hero') || id.includes('hero')) scores.hero += 50;
            if (className.includes('banner') || className.includes('jumbotron')) scores.hero += 40;
            if (actualTarget.querySelector('h1')) scores.hero += 20;

            if (className.includes('feature') || id.includes('feature')) scores.features += 50;
            if (className.includes('benefit') || className.includes('advantage')) scores.features += 40;

            if (className.includes('about') || id.includes('about')) scores.about += 50;
            if (className.includes('service') || id.includes('service')) scores.services += 50;

            if (className.includes('testimonial') || id.includes('testimonial')) scores.testimonials += 50;
            if (className.includes('depoimento') || className.includes('review')) scores.testimonials += 40;

            if (className.includes('pric') || id.includes('pric')) scores.pricing += 50;
            if (className.includes('plano') || className.includes('plan')) scores.pricing += 40;

            if (className.includes('cta') || id.includes('cta')) scores.cta += 50;
            if (className.includes('call-to-action')) scores.cta += 50;

            if (className.includes('contact') || id.includes('contact')) scores.contact += 50;
            if (className.includes('contato') || className.includes('form')) scores.contact += 40;
            if (actualTarget.querySelector('form')) scores.contact += 30;

            if (tagName === 'footer') scores.footer += 50;
            if (id.includes('footer') || className.includes('footer')) scores.footer += 30;

            let maxScore = 0;
            let category = 'other';
            for (const cat in scores) {
              if (scores[cat] > maxScore) {
                maxScore = scores[cat];
                category = cat;
              }
            }

            if (maxScore < 20) {
              category = 'other';
              maxScore = 10;
            }

            let sectionId = actualTarget.id || category;
            if (!actualTarget.id) {
              let counter = 1;
              while (document.getElementById(sectionId)) {
                sectionId = category + '-' + counter;
                counter++;
              }
              actualTarget.id = sectionId;
            }

            elementData.sectionInfo = {
              category: category,
              name: sectionId,
              id: sectionId,
              confidence: maxScore
            };

            // Armazenar no elemento DOM para recuperacao posterior
            actualTarget._cpSectionInfo = {
              category: category,
              name: sectionId,
              id: sectionId,
              confidence: maxScore
            };

            console.log('Secao detectada:', {
              cat: category,
              name: sectionId,
              id: sectionId,
              pos: positionPercent.toFixed(1) + '%',
              size: rect.width + 'x' + rect.height
            });
          }
        } catch (e) {
          console.warn('⚠️ [Editor] Erro ao detectar seção:', e);
        }

        console.log('📤 [Editor] Enviando dados do elemento selecionado:', {
          tagName: elementData.tagName,
          xpath: elementData.xpath?.substring(0, 50) + '...',
          hasSrc: !!elementData.src,
          hasHref: !!elementData.href,
          href: elementData.href ? elementData.href.substring(0, 50) : 'N/A',
          hasSection: !!elementData.sectionInfo
        });

        window.parent.postMessage({
          source: 'EDITOR_IFRAME',
          type: 'ELEMENT_SELECTED',
          data: elementData,
        }, '*');
      } catch (error) {
        console.error('❌ Erro ao enviar mensagem de seleção:', error);
      }
    }

    // 🔲 ADICIONAR RESIZE HANDLES ao elemento selecionado
    addResizeHandles(actualTarget);

    // ✅ Marcar que o editor processou o evento com sucesso
    editorClickProcessed = true;
    console.log('✅ [Editor] Click processado com sucesso');
  }, false); // false = bubble phase (executado DEPOIS dos listeners de bloqueio)

  // ============================================
  // 🎯 NOVO: RECEBER MENSAGENS DE ATUALIZAÇÃO
  // ============================================

  // 🛡️ PROTEÇÃO: Armazenar mudanças para prevenir reversões do Elementor
  const appliedChanges = new Map();

  // 🚨 CRÍTICO: Flag para prevenir loop infinito no MutationObserver
  let isApplyingChange = false;

  // 🛡️ PROTEÇÃO: MutationObserver para detectar reversões do Elementor
  const changeObserver = new MutationObserver(function(mutations) {
    // 🚨 PROTEÇÃO: Se estamos aplicando uma mudança, ignorar mutations para evitar loop
    if (isApplyingChange) {
      console.log('🛡️ [Editor] Ignorando mutation durante aplicação (evitando loop)');
      return;
    }

    mutations.forEach(function(mutation) {
      const target = mutation.target;

      // Verificar se este elemento tem mudanças aplicadas pelo editor
      appliedChanges.forEach(function(changeData, xpath) {
        const element = getElementByXPath(xpath);
        if (element === target) {
          console.log('🛡️ [Editor] Elementor tentou reverter mudança, reaplicando...');

          // 🚨 Marcar que estamos aplicando mudança para evitar loop infinito
          isApplyingChange = true;

          try {
            // Reaplicar a mudança
            if (changeData.type === 'style') {
              element.style[changeData.property] = changeData.value;
            } else if (changeData.type === 'attribute') {
              element.setAttribute(changeData.property, changeData.value);
            } else if (changeData.type === 'content') {
              if (changeData.property === 'textContent') {
                element.textContent = changeData.value;
              } else if (changeData.property === 'innerHTML') {
                element.innerHTML = changeData.value;
              }
            }
          } finally {
            // 🚨 Sempre desmarcar a flag, mesmo se houver erro
            setTimeout(function() {
              isApplyingChange = false;
            }, 100); // Delay de 100ms para garantir que a mutation foi processada
          }
        }
      });
    });
  });

  // 🚨 TEMPORARIAMENTE DESABILITADO: MutationObserver estava causando loop infinito
  // Observar mudanças no DOM inteiro
  // changeObserver.observe(document.body, {
  //   attributes: true,
  //   childList: true,
  //   subtree: true,
  //   characterData: true,
  //   attributeOldValue: true,
  //   characterDataOldValue: true
  // });

  console.log('⚠️ [Editor] MutationObserver DESABILITADO temporariamente para evitar loops');

  window.addEventListener('message', function(event) {
    // Validar origem (por segurança, aceitar de qualquer origem em modo dev)
    if (!event.data) return;

    const { source, type, data } = event.data;

    if (source === 'EDITOR_PARENT' && type === 'SET_EDITOR_VIEWPORT' && data && (data.viewport === 'desktop' || data.viewport === 'mobile')) {
      currentEditorViewport = data.viewport;
      console.log('📱🖥️ [Editor] Viewport definido:', currentEditorViewport);
      return;
    }

    // Processar UPDATE_ELEMENT
    if (source === 'EDITOR_PARENT' && type === 'UPDATE_ELEMENT' && data) {
      console.log('📨 [Editor] Recebido UPDATE_ELEMENT:', data);

      try {
        // 1. Encontrar elemento pelo XPath
        const element = getElementByXPath(data.xpath);
        if (!element) {
          console.error('❌ Elemento não encontrado para XPath:', data.xpath);
          return;
        }

        console.log('✅ Elemento encontrado:', element);

        // 📱🖥️ NOVO: Encontrar elementos equivalentes (versões desktop/mobile)
        const equivalentElements = findEquivalentElements(element, data.type, data.property);
        if (equivalentElements.length > 0) {
          console.log(\`📱 [Responsivo] Encontrados \${equivalentElements.length} elementos equivalentes (desktop/mobile)\`);
        }

        // 🛡️ PROTEÇÃO: Descongelar elemento se estiver congelado pelo Elementor
        try {
          if (Object.isFrozen(element)) {
            console.warn('⚠️ [Editor] Elemento estava congelado, tentando descongelar...');
          }
          if (Object.isSealed(element)) {
            console.warn('⚠️ [Editor] Elemento estava selado, tentando des-selar...');
          }
        } catch (e) {
          console.warn('⚠️ [Editor] Erro ao verificar status do elemento:', e);
        }

        // 🚨 CRÍTICO: Marcar que estamos aplicando mudança para evitar loop do MutationObserver
        isApplyingChange = true;

        try {
          // 2. Aplicar a mudança baseado no tipo
          switch (data.type) {
            case 'style':
              // Aplicar CSS com tratamento especial para animações e viewport
              console.log(\`🎨 Aplicando estilo \${data.property} = \${data.value}\`);

              // 📱🖥️ VIEWPORT: mobile → bloco cp-responsive-overrides; desktop/undefined → inline
              var isMobileViewport = data.viewport === 'mobile';
              if (isMobileViewport) {
                try {
                  applyResponsiveMobileOverride(element, data.property, data.value);
                } catch (err) {
                  console.warn('📱 [Responsivo] Fallback: aplicando inline', err);
                  element.style[data.property] = data.value;
                }
                break;
              }
              if (data.viewport === 'desktop' || data.viewport === undefined) {
                try {
                  removeResponsiveMobileOverrideForProperty(element, data.property);
                } catch (err) {
                  console.warn('📱 [Responsivo] removeResponsiveMobileOverrideForProperty ignorado', err);
                }
              }

              // 🎬 TRATAMENTO ESPECIAL para animações
              if (data.property === 'animation') {
                console.log('🎬 [Animation] Detectada aplicação de animação:', data.value);

                // Extrair nome da animação do valor
                const animationName = data.value.split(' ')[0];
                console.log('🎬 [Animation] Nome da animação extraída:', animationName);

                // Método 1: Tentar aplicar via estilo inline (padrão)
                const applyInlineStyle = () => {
                  console.log('🎬 [Animation] Método 1: Aplicando via estilo inline');
                  element.style.animation = 'none';
                  element.style.animationPlayState = 'paused';
                  void element.offsetWidth; // Forçar reflow
                  setTimeout(() => {
                    element.style.animation = data.value;
                    element.style.animationPlayState = 'running';
                    console.log('🎬 [Animation] Estilo inline aplicado:', data.value);
                  }, 10);
                };

                // Método 2: Fallback via classes CSS
                const applyClassBased = () => {
                  console.log('🎬 [Animation] Método 2: Aplicando via classes CSS');

                  // Remover todas as classes de animação anteriores
                  element.classList.remove(
                    'cp-animation-pulse', 'cp-animation-bounce', 'cp-animation-shake',
                    'cp-animation-fadeIn', 'cp-animation-slideInLeft', 'cp-animation-slideInRight',
                    'cp-animation-zoomIn', 'cp-animation-rotate', 'cp-animation-float'
                  );

                  // Limpar estilo inline
                  element.style.animation = '';

                  // Adicionar nova classe se não for 'none'
                  if (animationName !== 'none') {
                    const className = \`cp-animation-\${animationName}\`;
                    console.log('🎬 [Animation] Adicionando classe:', className);
                    element.classList.add(className);
                  }
                };

                // Tentar método 1 primeiro
                try {
                  applyInlineStyle();
                } catch (error) {
                  console.warn('🎬 [Animation] Erro no método 1, tentando método 2:', error);
                  applyClassBased();
                }

              } else {
                // Aplicar estilo normal para propriedades que não são animação (desktop)
                element.style[data.property] = data.value;
                // 📱 AJUSTE AUTOMÁTICO PARA MOBILE apenas quando não é override explícito mobile
                applyMobileAutoFix(element, data.property, data.value);
              }
              break;

          case 'attribute':
            // 🎠 SLIDER CONFIG: Tratamento especial para configuração de sliders
            if (data.property === 'slider-config') {
              console.log('🎠 [Slider] Reconfigurando slider:', data.value);
              
              try {
                const config = JSON.parse(data.value);
                const sliderInfo = detectSliderType(element);
                
                if (!sliderInfo) {
                  console.warn('⚠️ [Slider] Elemento não é um slider válido');
                  break;
                }
                
                // Aplicar configurações baseado no tipo de slider
                if (sliderInfo.type === 'swiper' && element.swiper) {
                  console.log('🎠 [Swiper] Aplicando configurações:', config);
                  
                  // Atualizar params do Swiper
                  const params = {
                    autoplay: config.autoplay ? { delay: config.delay || 3000 } : false,
                    speed: config.speed || 300,
                    loop: config.loop || false
                  };
                  
                  // Destruir e reinicializar com novos params
                  element.swiper.destroy(false, true);
                  
                  // Criar nova instância (se window.Swiper disponível)
                  if (window.Swiper) {
                    new window.Swiper(element, params);
                    console.log('✅ [Swiper] Reconfigurado com sucesso');
                  }
                } else if (sliderInfo.type === 'slick' && window.jQuery) {
                  console.log('🎠 [Slick] Aplicando configurações:', config);
                  
                  try {
                    // Destruir slider atual
                    window.jQuery(element).slick('unslick');
                    
                    // Reinicializar com novas configurações
                    window.jQuery(element).slick({
                      autoplay: config.autoplay,
                      autoplaySpeed: config.delay || 3000,
                      speed: config.speed || 300,
                      infinite: config.loop,
                      arrows: config.navigation,
                      dots: config.pagination
                    });
                    
                    console.log('✅ [Slick] Reconfigurado com sucesso');
                  } catch (e) {
                    console.error('❌ [Slick] Erro ao reconfigurar:', e);
                  }
                } else {
                  console.warn('⚠️ [Slider] Tipo não suportado ou instância não disponível:', sliderInfo.type);
                }
              } catch (error) {
                console.error('❌ [Slider] Erro ao aplicar configurações:', error);
              }
              
              break;
            }
            
            // Aplicar atributo normal
            console.log(\`📝 Aplicando atributo \${data.property} = \${data.value}\`);

            // 🗑️ REMOVER ATRIBUTO: Se o valor for vazio, remover o atributo
            if (!data.value || data.value === '') {
              console.log(\`🗑️ Removendo atributo \${data.property}\`);
              element.removeAttribute(data.property);

              // 🖼️ RELOAD FORÇADO: Se é uma imagem e removemos srcset/sizes, forçar recarga
              if ((data.property === 'srcset' || data.property === 'sizes') && element.tagName === 'IMG') {
                console.log(\`🔄 [IMG] Forçando reload da imagem após remover \${data.property}\`);
                const currentSrc = element.src;
                element.src = '';
                element.src = currentSrc;
              }
            } else if (data.property === 'class') {
              element.className = data.value;
            } else if (data.property === 'style') {
              element.setAttribute('style', data.value);
            } else if (data.property === 'src' && element.tagName === 'IMG') {
              // 🖼️ TRATAMENTO ESPECIAL para IMG src: forçar reload
              console.log(\`🖼️ [IMG] Atualizando src com reload forçado\`);
              // Remover srcset que tem prioridade sobre src
              element.removeAttribute('srcset');
              element.removeAttribute('sizes');
              element.src = ''; // Limpar primeiro
              setTimeout(function() {
                element.setAttribute('src', data.value);
              }, 10);
            } else {
              element.setAttribute(data.property, data.value);
            }
            break;

          case 'content':
            // Aplicar conteúdo
            console.log(\`📄 Aplicando conteúdo: \${data.value.substring(0, 50)}...\`);
            if (data.property === 'textContent') {
              element.textContent = data.value;
            } else if (data.property === 'innerHTML') {
              element.innerHTML = data.value;
            } else if (data.property === 'src') {
              // 🎬 ESPECIAL: Se é um iframe de YouTube, converter URL para formato de embed
              let finalValue = data.value;
              if (element.tagName === 'IFRAME') {
                // 🎬 DETECTAR: Verificar se é um iframe do Elementor para preservar parâmetros
                const isElementorIframe = element.classList.contains('elementor-video') ||
                                         element.hasAttribute('data-player-type') ||
                                         element.id && element.id.startsWith('widget');

                const convertedUrl = convertToYouTubeEmbed(data.value, isElementorIframe);
                if (convertedUrl !== data.value) {
                  if (isElementorIframe) {
                    console.log('🎬 [YouTube] URL Elementor convertida (preservando parâmetros)');
                  } else {
                    console.log('🎬 [YouTube] URL convertida para embed universal');
                  }
                  finalValue = convertedUrl;
                }

                // 🛡️ PREPARAÇÃO UNIVERSAL: Configurar iframe para todos os ambientes
                if (data.value.toLowerCase().includes('youtube')) {
                  prepareUniversalYouTubeIframe(element);
                }
              }
              element.setAttribute('src', finalValue);
            } else if (data.property === 'href') {
              element.setAttribute('href', data.value);
            }
            break;

          case 'link':
            // Aplicar link ao elemento (wrapping se necessario)
            console.log(\`🔗 Aplicando link: \${data.value}\`);
            if (element.tagName.toLowerCase() === 'a') {
              // Elemento ja e um link, apenas atualizar atributos
              element.setAttribute('href', data.value);
              if (data.metadata?.target) {
                element.setAttribute('target', data.metadata.target);
              }
              if (data.metadata?.rel) {
                element.setAttribute('rel', data.metadata.rel);
              }
            } else {
              // Elemento nao e um link, criar wrapper <a>
              const anchor = document.createElement('a');
              anchor.href = data.value;
              if (data.metadata?.target) {
                anchor.target = data.metadata.target;
              }
              if (data.metadata?.rel) {
                anchor.rel = data.metadata.rel;
              }

              // Clonar elemento atual
              const clonedElement = element.cloneNode(true);

              // Substituir elemento pelo wrapper
              element.parentNode.replaceChild(anchor, element);
              anchor.appendChild(clonedElement);

              console.log('🔗 Elemento envolvido com <a>');
            }
            break;

          case 'remove-link':
            // Remover link (unwrapping)
            console.log('🗑️ Removendo link');
            if (element.tagName.toLowerCase() === 'a') {
              // Extrair conteudo do link
              const parent = element.parentNode;
              while (element.firstChild) {
                parent.insertBefore(element.firstChild, element);
              }
              parent.removeChild(element);
              console.log('🗑️ Link removido, conteudo preservado');
            } else {
              console.warn('⚠️ Elemento nao e um link, nada a remover');
            }
            break;

          default:
            console.warn('⚠️ Tipo de atualização desconhecido:', data.type);
          }

          // 📱🖥️ NOVO: Aplicar mesma edição nos elementos equivalentes (desktop/mobile)
          if (equivalentElements && equivalentElements.length > 0) {
            console.log(\`📱 [Responsivo] Aplicando edição em \${equivalentElements.length} elementos equivalentes...\`);

            equivalentElements.forEach(function(equivElement, index) {
              try {
                console.log(\`📱 [Responsivo] Aplicando em equivalente \${index + 1}/\${equivalentElements.length}\`);

                switch (data.type) {
                  case 'style':
                    equivElement.style[data.property] = data.value;
                    break;

                  case 'attribute':
                    if (!data.value || data.value === '') {
                      equivElement.removeAttribute(data.property);
                    } else if (data.property === 'src' && equivElement.tagName === 'IMG') {
                      equivElement.removeAttribute('srcset');
                      equivElement.removeAttribute('sizes');
                      equivElement.src = '';
                      setTimeout(function() {
                        equivElement.setAttribute('src', data.value);
                      }, 10);
                    } else {
                      equivElement.setAttribute(data.property, data.value);
                    }
                    break;

                  case 'content':
                    if (data.property === 'textContent') {
                      equivElement.textContent = data.value;
                    } else if (data.property === 'innerHTML') {
                      equivElement.innerHTML = data.value;
                    } else if (data.property === 'src') {
                      let finalValue = data.value;
                      if (equivElement.tagName === 'IFRAME' && data.value.toLowerCase().includes('youtube')) {
                        finalValue = convertToYouTubeEmbed(data.value, false);
                      }
                      equivElement.setAttribute('src', finalValue);
                    } else if (data.property === 'href') {
                      equivElement.setAttribute('href', data.value);
                    }
                    break;
                }

                console.log(\`✅ [Responsivo] Equivalente \${index + 1} atualizado!\`);
              } catch (equivError) {
                console.warn(\`⚠️ [Responsivo] Erro ao atualizar equivalente \${index + 1}:\`, equivError);
              }
            });

            console.log(\`📱 [Responsivo] Total: \${equivalentElements.length + 1} elementos atualizados (principal + equivalentes)\`);
          }

          // 🛡️ PROTEÇÃO: Armazenar mudança para reaplicação se necessário (DESABILITADO)
          // appliedChanges.set(data.xpath, {
          //   type: data.type,
          //   property: data.property,
          //   value: data.value
          // });

          console.log('✅ Atualização aplicada com sucesso!');

          // Enviar confirmação
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({
              source: 'EDITOR_IFRAME',
              type: 'ELEMENT_UPDATED',
              data: { xpath: data.xpath, property: data.property, success: true }
            }, '*');
          }
        } finally {
          // 🚨 CRÍTICO: Sempre desmarcar a flag, mesmo se houver erro
          setTimeout(function() {
            isApplyingChange = false;
            console.log('🛡️ [Editor] Flag de aplicação desmarcada, MutationObserver pode observar novamente');
          }, 100); // Delay de 100ms para garantir que a mutation foi processada
        }

      } catch (error) {
        console.error('❌ Erro ao aplicar atualização:', error);
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            source: 'EDITOR_IFRAME',
            type: 'ELEMENT_UPDATED',
            data: { xpath: data.xpath, property: data.property, success: false, error: error.message }
          }, '*');
        }
      }
    }

    // Processar GET_HTML
    if (source === 'EDITOR_PARENT' && type === 'GET_HTML') {
      console.log('📤 [Editor] GET_HTML solicitado');
      try {
        const html = document.documentElement.outerHTML;
        window.parent.postMessage({
          source: 'EDITOR_IFRAME',
          type: 'HTML_CONTENT',
          data: html
        }, '*');
      } catch (error) {
        console.error('❌ Erro ao enviar HTML:', error);
      }
    }

    // Processar RESTORE_HTML
    if (source === 'EDITOR_PARENT' && type === 'RESTORE_HTML') {
      console.log('♻️ [Editor] RESTORE_HTML solicitado');
      window.location.reload();
    }

    // 🎯 Processar APPLY_HTML (para Undo/Redo)
    if (source === 'EDITOR_PARENT' && type === 'APPLY_HTML' && data) {
      try {
        // Limpar seleção atual
        if (selectedElement) {
          selectedElement.classList.remove('cp-selected');
          selectedElement = null;
        }

        // Criar documento a partir do HTML
        var parser = new DOMParser();
        var newDoc = parser.parseFromString(data, 'text/html');

        if (newDoc.body) {
          // Substituir conteúdo do body
          document.body.innerHTML = newDoc.body.innerHTML;

          // Copiar estilo do body
          if (newDoc.body.hasAttribute('style')) {
            document.body.setAttribute('style', newDoc.body.getAttribute('style'));
          }

          // Remover classes de seleção que podem ter vindo no HTML
          document.querySelectorAll('.cp-selected, .cp-hover-highlight').forEach(function(el) {
            el.classList.remove('cp-selected', 'cp-hover-highlight');
          });

          window.parent.postMessage({
            source: 'EDITOR_IFRAME',
            type: 'ELEMENT_UPDATED',
            data: { action: 'undo_redo' }
          }, '*');
        }
      } catch (error) {
        console.error('❌ [Editor] Erro ao aplicar Undo/Redo:', error);
      }
    }

    // Processar DUPLICATE_ELEMENT
    if (source === 'EDITOR_PARENT' && type === 'DUPLICATE_ELEMENT') {
      console.log('📋 [Editor] DUPLICATE_ELEMENT solicitado');
      try {
        if (!selectedElement) {
          console.error('❌ Nenhum elemento selecionado para duplicar');
          return;
        }

        // Clonar o elemento (true = clonar todos os filhos)
        const clonedElement = selectedElement.cloneNode(true);

        // Inserir o clone logo após o elemento original
        if (selectedElement.parentNode) {
          selectedElement.parentNode.insertBefore(clonedElement, selectedElement.nextSibling);
          console.log('✅ Elemento duplicado com sucesso:', clonedElement);

          // Notificar o pai que o elemento foi duplicado
          window.parent.postMessage({
            source: 'EDITOR_IFRAME',
            type: 'ELEMENT_UPDATED'
          }, '*');
        } else {
          console.error('❌ Elemento não possui pai para inserir clone');
        }
      } catch (error) {
        console.error('❌ Erro ao duplicar elemento:', error);
      }
    }

    // 🎨 Processar GET_SECTION_BACKGROUND - Obter background de uma seção específica
    if (source === 'EDITOR_PARENT' && type === 'GET_SECTION_BACKGROUND' && data && data.sectionId) {
      console.log('🎨 [Editor] GET_SECTION_BACKGROUND solicitado para:', data.sectionId);
      try {
        // Se for 'body', usar document.body
        let sectionEl = null;
        if (data.sectionId === 'body') {
          sectionEl = document.body;
        } else {
          sectionEl = document.getElementById(data.sectionId);
        }
        
        if (!sectionEl) {
          window.parent.postMessage({
            source: 'EDITOR_IFRAME',
            type: 'SECTION_BACKGROUND_DATA',
            data: { error: 'Seção não encontrada' }
          }, '*');
          return;
        }

        // 🎨 MELHORADO: Detectar background considerando elementos pais
        // Se o elemento não tem background próprio, verificar elementos pais
        let sectionElToCheck = sectionEl;
        let computedStyle = window.getComputedStyle(sectionElToCheck);
        let inlineStyle = sectionElToCheck.style;
        
        // Verificar se o elemento atual tem background
        let hasOwnBackground = 
          (inlineStyle.backgroundColor && inlineStyle.backgroundColor !== 'transparent' && inlineStyle.backgroundColor !== 'rgba(0, 0, 0, 0)') ||
          (inlineStyle.backgroundImage && inlineStyle.backgroundImage !== 'none') ||
          (computedStyle.backgroundColor && computedStyle.backgroundColor !== 'transparent' && computedStyle.backgroundColor !== 'rgba(0, 0, 0, 0)') ||
          (computedStyle.backgroundImage && computedStyle.backgroundImage !== 'none');
        
        // Se não tem background próprio, verificar elementos pais (até 3 níveis)
        if (!hasOwnBackground) {
          let parent = sectionElToCheck.parentElement;
          let depth = 0;
          while (parent && depth < 3 && parent !== document.body) {
            const parentComputed = window.getComputedStyle(parent);
            const parentInline = parent.style;
            
            const parentHasBackground = 
              (parentInline.backgroundColor && parentInline.backgroundColor !== 'transparent' && parentInline.backgroundColor !== 'rgba(0, 0, 0, 0)') ||
              (parentInline.backgroundImage && parentInline.backgroundImage !== 'none') ||
              (parentComputed.backgroundColor && parentComputed.backgroundColor !== 'transparent' && parentComputed.backgroundColor !== 'rgba(0, 0, 0, 0)') ||
              (parentComputed.backgroundImage && parentComputed.backgroundImage !== 'none');
            
            if (parentHasBackground) {
              sectionElToCheck = parent;
              computedStyle = parentComputed;
              inlineStyle = parentInline;
              console.log('🎨 [Editor] Background encontrado em elemento pai (nível ' + depth + ')');
              break;
            }
            
            parent = parent.parentElement;
            depth++;
          }
        }
        
        // Detectar background (prioridade: inline > computed)
        const backgroundColor = inlineStyle.backgroundColor || computedStyle.backgroundColor || 'transparent';
        const backgroundImage = inlineStyle.backgroundImage || computedStyle.backgroundImage || 'none';
        const backgroundSize = inlineStyle.backgroundSize || computedStyle.backgroundSize || 'auto';
        const backgroundPosition = inlineStyle.backgroundPosition || computedStyle.backgroundPosition || 'center';
        const backgroundRepeat = inlineStyle.backgroundRepeat || computedStyle.backgroundRepeat || 'no-repeat';
        
        // Extrair URL da imagem se existir
        let imageUrl = null;
        if (backgroundImage && backgroundImage !== 'none') {
          const urlMatch = backgroundImage.match(/url\\(["']?([^"')]+)["']?\\)/);
          if (urlMatch) {
            imageUrl = urlMatch[1];
            // Converter URL relativa para absoluta se necessário
            if (imageUrl.startsWith('/')) {
              imageUrl = window.location.origin + imageUrl;
            } else if (!imageUrl.startsWith('http') && !imageUrl.startsWith('data:')) {
              imageUrl = new URL(imageUrl, window.location.href).href;
            }
          }
        }

        const backgroundInfo = {
          sectionId: data.sectionId,
          backgroundColor: backgroundColor,
          backgroundImage: backgroundImage,
          imageUrl: imageUrl,
          backgroundSize: backgroundSize,
          backgroundPosition: backgroundPosition,
          backgroundRepeat: backgroundRepeat,
          hasImage: !!imageUrl,
          hasColor: backgroundColor !== 'transparent' && backgroundColor !== 'rgba(0, 0, 0, 0)'
        };

        console.log('🎨 [Editor] Background detectado:', backgroundInfo);

        window.parent.postMessage({
          source: 'EDITOR_IFRAME',
          type: 'SECTION_BACKGROUND_DATA',
          data: backgroundInfo
        }, '*');
      } catch (error) {
        console.error('❌ [Editor] Erro ao obter background da seção:', error);
        window.parent.postMessage({
          source: 'EDITOR_IFRAME',
          type: 'SECTION_BACKGROUND_DATA',
          data: { error: error.message }
        }, '*');
      }
    }

    // 🔧 Processar GET_PAGE_SETTINGS - Obter configurações atuais da página
    if (source === 'EDITOR_PARENT' && type === 'GET_PAGE_SETTINGS') {
      console.log('🔧 [Editor] GET_PAGE_SETTINGS solicitado');
      try {
        var settings = {
          title: document.title || '',
          description: '',
          keywords: '',
          favicon: '',
          headerCode: '',
          footerCode: ''
        };

        // Buscar meta description
        var metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
          settings.description = metaDesc.getAttribute('content') || '';
        }

        // Buscar meta keywords
        var metaKeywords = document.querySelector('meta[name="keywords"]');
        if (metaKeywords) {
          settings.keywords = metaKeywords.getAttribute('content') || '';
        }

        // Buscar favicon
        var favicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
        if (favicon) {
          settings.favicon = favicon.getAttribute('href') || '';
        }

        // Buscar códigos customizados previamente injetados
        var headerCodeEl = document.querySelector('script[data-clonepages-header]');
        if (headerCodeEl) {
          settings.headerCode = headerCodeEl.innerHTML || '';
        }

        var footerCodeEl = document.querySelector('script[data-clonepages-footer]');
        if (footerCodeEl) {
          settings.footerCode = footerCodeEl.innerHTML || '';
        }

        console.log('🔧 [Editor] Configurações extraídas:', settings);

        window.parent.postMessage({
          source: 'EDITOR_IFRAME',
          type: 'PAGE_SETTINGS_DATA',
          data: settings
        }, '*');
      } catch (error) {
        console.error('❌ Erro ao buscar configurações:', error);
      }
    }

    // 🔧 Processar UPDATE_PAGE_SETTINGS - Atualizar configurações da página
    if (source === 'EDITOR_PARENT' && type === 'UPDATE_PAGE_SETTINGS' && data) {
      console.log('🔧 [Editor] UPDATE_PAGE_SETTINGS recebido:', data);
      try {
        // Atualizar título da página
        if (data.title !== undefined && data.title !== document.title) {
          document.title = data.title;
          console.log('📄 [Editor] Título atualizado para:', data.title);
        }

        // Atualizar meta description
        if (data.description !== undefined) {
          var metaDesc = document.querySelector('meta[name="description"]');
          if (!metaDesc) {
            metaDesc = document.createElement('meta');
            metaDesc.setAttribute('name', 'description');
            document.head.appendChild(metaDesc);
          }
          metaDesc.setAttribute('content', data.description);
          console.log('📝 [Editor] Meta description atualizada');
        }

        // Atualizar meta keywords
        if (data.keywords !== undefined) {
          var metaKeywords = document.querySelector('meta[name="keywords"]');
          if (!metaKeywords) {
            metaKeywords = document.createElement('meta');
            metaKeywords.setAttribute('name', 'keywords');
            document.head.appendChild(metaKeywords);
          }
          metaKeywords.setAttribute('content', data.keywords);
          console.log('🏷️ [Editor] Meta keywords atualizada');
        }

        // Atualizar favicon
        if (data.favicon !== undefined) {
          var existingFavicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');

          // Remover favicons existentes
          var allFavicons = document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]');
          allFavicons.forEach(function(el) { el.remove(); });

          if (data.favicon) {
            var newFavicon = document.createElement('link');
            newFavicon.setAttribute('rel', 'icon');
            // Detectar tipo pelo prefixo base64 ou extensão
            if (data.favicon.startsWith('data:image/png')) {
              newFavicon.setAttribute('type', 'image/png');
            } else if (data.favicon.startsWith('data:image/x-icon') || data.favicon.endsWith('.ico')) {
              newFavicon.setAttribute('type', 'image/x-icon');
            } else if (data.favicon.startsWith('data:image/svg') || data.favicon.endsWith('.svg')) {
              newFavicon.setAttribute('type', 'image/svg+xml');
            }
            newFavicon.setAttribute('href', data.favicon);
            document.head.appendChild(newFavicon);
            console.log('🎨 [Editor] Favicon atualizado');
          }
        }

        // Atualizar código do header
        if (data.headerCode !== undefined) {
          // Remover código anterior se existir
          var oldHeaderCode = document.querySelector('script[data-clonepages-header]');
          if (oldHeaderCode) oldHeaderCode.remove();

          if (data.headerCode.trim()) {
            var headerScript = document.createElement('script');
            headerScript.setAttribute('data-clonepages-header', 'true');
            headerScript.innerHTML = data.headerCode;
            document.head.appendChild(headerScript);
            console.log('🔝 [Editor] Código do header injetado');
          }
        }

        // Atualizar código do footer
        if (data.footerCode !== undefined) {
          // Remover código anterior se existir
          var oldFooterCode = document.querySelector('script[data-clonepages-footer]');
          if (oldFooterCode) oldFooterCode.remove();

          if (data.footerCode.trim()) {
            var footerScript = document.createElement('script');
            footerScript.setAttribute('data-clonepages-footer', 'true');
            footerScript.innerHTML = data.footerCode;
            document.body.appendChild(footerScript);
            console.log('🔚 [Editor] Código do footer injetado');
          }
        }

        // Notificar que as configurações foram atualizadas
        window.parent.postMessage({
          source: 'EDITOR_IFRAME',
          type: 'PAGE_SETTINGS_UPDATED',
          data: { success: true }
        }, '*');

        console.log('✅ [Editor] Configurações da página atualizadas com sucesso');
      } catch (error) {
        console.error('❌ Erro ao atualizar configurações:', error);
        window.parent.postMessage({
          source: 'EDITOR_IFRAME',
          type: 'PAGE_SETTINGS_UPDATED',
          data: { success: false, error: error.message }
        }, '*');
      }
    }

    // Processar GET_SECTIONS
    if (source === 'EDITOR_PARENT' && type === 'GET_SECTIONS') {
      console.log('🎯 [Editor] GET_SECTIONS solicitado - iniciando varredura automatica');
      try {
        const sections = [];
        const processedIds = new Set();

        // Funcao auxiliar para detectar e categorizar secao
        const detectSection = function(el) {
          try {
            const rect = el.getBoundingClientRect();
            const isLargeElement = rect.height > 100 || rect.width > 300;
            const isSectionTag = ['HEADER', 'FOOTER', 'SECTION', 'NAV', 'ASIDE', 'MAIN', 'ARTICLE'].includes(el.tagName);
            const isDivContainer = el.tagName === 'DIV' && (
              (el.className || '').includes('section') ||
              (el.className || '').includes('container') ||
              (el.className || '').includes('elementor') ||
              (el.className || '').includes('wp-block') ||
              isLargeElement
            );

            if (!isSectionTag && !isDivContainer) return null;

            const tagName = el.tagName.toLowerCase();
            const className = (el.className || '').toLowerCase();
            const id = (el.id || '').toLowerCase();

            const scrollY = window.pageYOffset || document.documentElement.scrollTop;
            const docHeight = document.documentElement.scrollHeight;
            const elementTop = rect.top + scrollY;
            const positionPercent = (elementTop / docHeight) * 100;

            const scores = {
              header: 0, hero: 0, features: 0, about: 0, services: 0,
              testimonials: 0, pricing: 0, cta: 0, contact: 0, footer: 0, other: 0
            };

            if (positionPercent < 15) {
              scores.header += 40;
              scores.hero += 30;
            } else if (positionPercent < 30) {
              scores.hero += 40;
            } else if (positionPercent > 85) {
              scores.footer += 40;
            }

            if (tagName === 'header') scores.header += 50;
            if (id.includes('header') || id.includes('nav')) scores.header += 30;
            if (className.includes('header') || className.includes('navbar')) scores.header += 30;

            if (className.includes('hero') || id.includes('hero')) scores.hero += 50;
            if (className.includes('banner') || className.includes('jumbotron')) scores.hero += 40;
            if (el.querySelector('h1')) scores.hero += 20;

            if (className.includes('feature') || id.includes('feature')) scores.features += 50;
            if (className.includes('about') || id.includes('about')) scores.about += 50;
            if (className.includes('service') || id.includes('service')) scores.services += 50;
            if (className.includes('testimonial') || id.includes('testimonial')) scores.testimonials += 50;
            if (className.includes('pric') || id.includes('pric')) scores.pricing += 50;
            if (className.includes('cta') || id.includes('cta')) scores.cta += 50;
            if (className.includes('contact') || id.includes('contact')) scores.contact += 50;

            if (tagName === 'footer') scores.footer += 50;
            if (id.includes('footer') || className.includes('footer')) scores.footer += 30;

            let maxScore = 0;
            let category = 'other';
            for (const cat in scores) {
              if (scores[cat] > maxScore) {
                maxScore = scores[cat];
                category = cat;
              }
            }

            if (maxScore < 20) {
              category = 'other';
              maxScore = 10;
            }

            let sectionId = el.id || category;
            if (!el.id) {
              let counter = 1;
              while (document.getElementById(sectionId) || processedIds.has(sectionId)) {
                sectionId = category + '-' + counter;
                counter++;
              }
              el.id = sectionId;
            }

            // Armazenar no elemento DOM
            el._cpSectionInfo = {
              category: category,
              name: sectionId,
              id: sectionId,
              confidence: maxScore
            };

            // 🎨 Detectar background da seção
            const computedStyle = window.getComputedStyle(el);
            const inlineStyle = el.style;
            const backgroundImage = inlineStyle.backgroundImage || computedStyle.backgroundImage || 'none';
            const backgroundColor = inlineStyle.backgroundColor || computedStyle.backgroundColor || 'transparent';
            
            let imageUrl = null;
            if (backgroundImage && backgroundImage !== 'none') {
              const urlMatch = backgroundImage.match(/url\\(["']?([^"')]+)["']?\\)/);
              if (urlMatch) {
                imageUrl = urlMatch[1];
                if (imageUrl.startsWith('/')) {
                  imageUrl = window.location.origin + imageUrl;
                } else if (!imageUrl.startsWith('http') && !imageUrl.startsWith('data:')) {
                  try {
                    imageUrl = new URL(imageUrl, window.location.href).href;
                  } catch (e) {
                    // URL inválida, manter como está
                  }
                }
              }
            }

            return {
              id: sectionId,
              category: category,
              name: sectionId,
              hasBackgroundImage: !!imageUrl,
              hasBackgroundColor: backgroundColor !== 'transparent' && backgroundColor !== 'rgba(0, 0, 0, 0)',
              backgroundImageUrl: imageUrl
            };
          } catch (e) {
            return null;
          }
        };

        // 🎯 ESTRATEGIA NOVA: Detectar secoes filhas do container principal

        // 1. Identificar o container principal da pagina
        const findMainContainer = function() {
          // Procurar containers tipicos de paginas (Elementor, WordPress, etc)
          const possibleMainContainers = [
            document.querySelector('div.elementor:not([class*="element-"])'), // Elementor principal
            document.querySelector('div.page'),
            document.querySelector('div#page'),
            document.querySelector('main'),
            document.querySelector('div#content'),
            document.querySelector('div.site-content'),
            document.body
          ];

          for (let i = 0; i < possibleMainContainers.length; i++) {
            if (possibleMainContainers[i]) {
              return possibleMainContainers[i];
            }
          }

          return document.body;
        };

        const mainContainer = findMainContainer();
        console.log('🏠 [GET_SECTIONS] Container principal identificado:', {
          tag: mainContainer.tagName,
          id: mainContainer.id || '(sem id)',
          classes: mainContainer.className || '(sem classes)'
        });

        // 2. Funcao para verificar se elemento e filho direto ou proximo (1-2 niveis) do container principal
        const isDirectOrNearChild = function(el, container) {
          let current = el.parentElement;
          let depth = 0;

          while (current && depth < 3) {
            if (current === container) {
              return true;
            }
            current = current.parentElement;
            depth++;
          }

          return false;
        };

        // 3. Funcao para verificar se elemento esta dentro de OUTRA secao (nao o container principal)
        const isInsideAnotherSection = function(el, sectionsList) {
          for (let i = 0; i < sectionsList.length; i++) {
            const other = sectionsList[i];
            if (other !== el && other.contains(el)) {
              // Verificar se o "other" nao e o container principal
              if (other !== mainContainer) {
                // Comparar tamanhos: se o "other" e muito maior (wrapper), nao conta
                const elRect = el.getBoundingClientRect();
                const otherRect = other.getBoundingClientRect();
                const sizeRatio = (otherRect.height * otherRect.width) / (elRect.height * elRect.width);

                // Se o "other" e menos de 5x maior, entao e realmente uma secao mae
                if (sizeRatio < 5) {
                  return true;
                }
              }
            }
          }
          return false;
        };

        // 4. Coletar candidatos potenciais
        const allElements = document.querySelectorAll('header, footer, section, nav, aside, main, article, div');
        const candidates = [];

        allElements.forEach(function(el) {
          const rect = el.getBoundingClientRect();
          const isLargeElement = rect.height > 100 || rect.width > 300;
          const isSectionTag = ['HEADER', 'FOOTER', 'SECTION', 'NAV', 'ASIDE', 'MAIN', 'ARTICLE'].includes(el.tagName);

          // 🎯 ESPECIAL: Elementor usa "e-con" para containers de secao
          const isElementorSection = el.tagName === 'DIV' && (
            (el.className || '').includes('e-con') &&
            !(el.className || '').includes('e-con-inner')
          );

          const isDivContainer = el.tagName === 'DIV' && (
            (el.className || '').includes('section') ||
            (el.className || '').includes('container') ||
            (el.className || '').includes('wp-block') ||
            isLargeElement
          );

          // Adicionar candidatos: tags semanticas, secoes Elementor, ou divs grandes
          if (isSectionTag || isElementorSection || isDivContainer) {
            // Nao adicionar o proprio container principal
            if (el !== mainContainer) {
              candidates.push(el);
            }
          }
        });

        console.log('🔍 [GET_SECTIONS] Candidatos totais:', candidates.length);

        // 5. Filtrar secoes raiz (filhas do container principal, nao aninhadas em outras secoes)
        const rootSections = [];
        candidates.forEach(function(el) {
          const isNearChild = isDirectOrNearChild(el, mainContainer);
          const isNested = isInsideAnotherSection(el, candidates);

          // Tags semanticas sempre incluir se forem filhas proximas
          const isSemantic = ['HEADER', 'FOOTER', 'SECTION', 'NAV', 'ASIDE', 'MAIN', 'ARTICLE'].includes(el.tagName);

          // Secoes Elementor (e-con) sempre incluir se forem filhas proximas
          const isElementorSection = (el.className || '').includes('e-con') && !(el.className || '').includes('e-con-inner');

          if (isNearChild && !isNested) {
            rootSections.push(el);
          } else if ((isSemantic || isElementorSection) && isNearChild) {
            // Incluir tags semanticas e secoes Elementor mesmo se detectadas como aninhadas
            rootSections.push(el);
          }
        });

        console.log('🎯 [GET_SECTIONS] Secoes raiz (blocos mae):', rootSections.length);
        console.log('📋 [GET_SECTIONS] Lista de secoes detectadas:', rootSections.map(function(el) {
          return {
            tag: el.tagName,
            id: el.id || '(sem id)',
            classes: (el.className || '').substring(0, 50) + '...'
          };
        }));

        // Processar apenas as secoes raiz
        rootSections.forEach(function(el, index) {
          console.log(\`📌 [GET_SECTIONS] Processando secao raiz \${index + 1}/\${rootSections.length}\`, {
            tag: el.tagName,
            id: el.id || '(sem id)',
            classes: el.className || '(sem classes)',
            temSectionInfo: !!el._cpSectionInfo
          });

          // Se ja tem _cpSectionInfo, usar ele
          if (el._cpSectionInfo) {
            console.log('  ✅ Ja tem _cpSectionInfo:', el._cpSectionInfo);
            if (!processedIds.has(el._cpSectionInfo.id)) {
              sections.push({
                id: el._cpSectionInfo.id,
                category: el._cpSectionInfo.category,
                name: el._cpSectionInfo.name
              });
              processedIds.add(el._cpSectionInfo.id);
              console.log('  ✅ Adicionado ao array de secoes');
            } else {
              console.log('  ⚠️ ID ja processado, pulando');
            }
          } else {
            // Se nao tem, detectar agora
            console.log('  🔍 Nao tem _cpSectionInfo, detectando agora...');
            const sectionInfo = detectSection(el);
            if (sectionInfo) {
              console.log('  ✅ Deteccao bem-sucedida:', sectionInfo);
              if (!processedIds.has(sectionInfo.id)) {
                sections.push(sectionInfo);
                processedIds.add(sectionInfo.id);
                console.log('  ✅ Adicionado ao array de secoes');
              } else {
                console.log('  ⚠️ ID ja processado, pulando');
              }
            } else {
              console.log('  ❌ Deteccao falhou (retornou null)');
            }
          }
        });

        console.log('🎯 [Editor] Secoes detectadas automaticamente:', sections.length);
        console.log('📋 [Editor] Lista de secoes:', sections);

        window.parent.postMessage({
          source: 'EDITOR_IFRAME',
          type: 'SECTIONS_LIST',
          data: sections
        }, '*');
      } catch (error) {
        console.error('❌ Erro ao buscar secoes:', error);
      }
    }
  });

  // 🎯 SMOOTH SCROLL: DESABILITADO EM MODO EDIÇÃO
  // Em modo edição, queremos apenas SELECIONAR os elementos, não navegar
  // O bloqueio de navegação acima (linha 2232) já previne o comportamento padrão
  // Este handler de smooth scroll estava causando navegação indesejada durante edição
  /*
  document.addEventListener('click', function(e) {
    const target = e.target.closest('a');
    if (!target) return;

    const href = target.getAttribute('href');
    if (!href || !href.startsWith('#')) return;

    // Prevenir comportamento padrao
    e.preventDefault();

    // Buscar elemento alvo
    const targetId = href.substring(1);
    let targetElement = null;

    // Tentar encontrar por ID direto
    targetElement = document.getElementById(targetId);

    // Se nao encontrar, procurar em elementos com sectionInfo
    if (!targetElement) {
      const allElements = document.querySelectorAll('*');
      for (let i = 0; i < allElements.length; i++) {
        const el = allElements[i];
        if (el._cpSectionInfo && el._cpSectionInfo.id === targetId) {
          targetElement = el;
          break;
        }
      }
    }

    if (targetElement) {
      console.log('🎯 [SmoothScroll] Navegando para:', targetId);
      targetElement.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    } else {
      console.warn('⚠️ [SmoothScroll] Elemento nao encontrado:', targetId);
    }
  });
  */
  console.log('🚫 [Editor] Smooth scroll desabilitado em modo edição');

  console.log('✅ Editor inicializado com UPDATE_ELEMENT listener e smooth scroll');
})();
</script>
`;
  }

  /**
   * 🎯 PUBLIC METHOD: Injetar editor script no HTML
   * Usado pelo endpoint POST /inject-editor para reinjetar editor após salvar edições
   */
  public injectEditorScript(html: string): string {
    console.log(
      '🔧 [injectEditorScript] Injetando editor no HTML tamanho:',
      html.length
    );

    // Remover scripts de editor anteriores (em caso de re-injeção)
    let cleanedHtml = html.replace(
      /<script[^>]*id="cp-editor-script"[^>]*>[\s\S]*?<\/script>/gi,
      ''
    );
    cleanedHtml = cleanedHtml.replace(
      /<script[^>]*id="cp-protection-script"[^>]*>[\s\S]*?<\/script>/gi,
      ''
    );

    // 🎬 Desativar autoplay do YouTube (importante para modo edição)
    cleanedHtml = this.disableYouTubeAutoplay(cleanedHtml);

    // Adicionar script de proteção no head
    const protectionScript = this.getProtectionScript();
    cleanedHtml = cleanedHtml.replace(
      /<head[^>]*>/i,
      `<head>\n${protectionScript}`
    );

    // Adicionar script de editor no body
    const editorScript = this.getEditModeScript();
    cleanedHtml = cleanedHtml.replace(/<\/body>/i, `${editorScript}\n</body>`);

    console.log(
      '✅ [injectEditorScript] Editor injetado! Novo tamanho:',
      cleanedHtml.length
    );
    return cleanedHtml;
  }

  /**
   * 🔍 ANALYZE: Detectar e listar todos os códigos de rastreamento no HTML
   * Analisa o HTML antes da limpeza para identificar todos os rastreadores
   */
  public analyzeTrackingCodes(html: string): TrackingAnalysisResult {
    console.log(
      '🔍 [analyzeTrackingCodes] Iniciando análise de códigos de rastreamento...'
    );

    const trackers: TrackingCode[] = [];
    const lines = html.split('\n');
    let lineNumber = 0;

    // === FACEBOOK / META PIXEL ===
    const facebookPixelRegex =
      /fbq\s*\(['"](init|track)['"]\s*,\s*['"]?([^'"\s,)]+)['"]?/gi;
    let facebookMatch;
    while ((facebookMatch = facebookPixelRegex.exec(html)) !== null) {
      const snippet = this.extractSnippet(html, facebookMatch.index, 200);
      const pixelId = facebookMatch[2] || 'unknown';
      trackers.push({
        type: 'Facebook Pixel',
        category: 'pixel',
        name: `Facebook Pixel ${
          facebookMatch[1] === 'init' ? 'Init' : 'Track'
        }`,
        identifier: pixelId,
        domain: 'connect.facebook.net',
        snippet: snippet,
        location: this.detectLocation(html, facebookMatch.index),
        lineNumber: this.getLineNumber(html, facebookMatch.index, lines),
        risk: 'high',
      });
    }

    // Verificar Meta Pixel Code blocks comentados
    const metaPixelBlockRegex =
      /<!--\s*Meta\s+Pixel\s+Code\s*-->[\s\S]*?<!--\s*End\s+Meta\s+Pixel\s+Code\s*-->/gi;
    let metaPixelBlockMatch;
    while ((metaPixelBlockMatch = metaPixelBlockRegex.exec(html)) !== null) {
      const pixelIdMatch = metaPixelBlockMatch[0].match(
        /fbq\(['"]init['"]\s*,\s*['"]?([^'"\s,)]+)['"]?/i
      );
      trackers.push({
        type: 'Facebook Pixel (Commented Block)',
        category: 'pixel',
        name: 'Meta Pixel Code Block',
        identifier: pixelIdMatch ? pixelIdMatch[1] : 'unknown',
        domain: 'connect.facebook.net',
        snippet: metaPixelBlockMatch[0].substring(0, 300) + '...',
        location: this.detectLocation(html, metaPixelBlockMatch.index),
        lineNumber: this.getLineNumber(html, metaPixelBlockMatch.index, lines),
        risk: 'high',
      });
    }

    // === GOOGLE ANALYTICS ===
    const gaRegex =
      /(?:ga\(|gtag\(|_gaq\.|GoogleAnalytics|googletagmanager\.com)/gi;
    let gaMatch;
    while ((gaMatch = gaRegex.exec(html)) !== null) {
      const snippet = this.extractSnippet(html, gaMatch.index, 200);
      const gaIdMatch = html
        .substring(gaMatch.index, gaMatch.index + 300)
        .match(/(?:UA-|G-|GTM-)([A-Z0-9-]+)/i);
      trackers.push({
        type: 'Google Analytics',
        category: 'analytics',
        name: 'Google Analytics / gtag',
        identifier: gaIdMatch ? gaIdMatch[0] : 'unknown',
        domain: 'analytics.google.com',
        snippet: snippet,
        location: this.detectLocation(html, gaMatch.index),
        lineNumber: this.getLineNumber(html, gaMatch.index, lines),
        risk: 'medium',
      });
    }

    // === GOOGLE TAG MANAGER ===
    const gtmRegex = /googletagmanager\.com\/gtm\.js[^"']*id=([^"'\s&>]+)/gi;
    let gtmMatch;
    while ((gtmMatch = gtmRegex.exec(html)) !== null) {
      const snippet = this.extractSnippet(html, gtmMatch.index, 200);
      trackers.push({
        type: 'Google Tag Manager',
        category: 'tag-manager',
        name: 'Google Tag Manager',
        identifier: gtmMatch[1] || 'unknown',
        domain: 'googletagmanager.com',
        snippet: snippet,
        location: this.detectLocation(html, gtmMatch.index),
        lineNumber: this.getLineNumber(html, gtmMatch.index, lines),
        risk: 'high',
      });
    }

    // Verificar noscript GTM
    const gtmNoscriptRegex =
      /<!--\s*Google\s+Tag\s+Manager\s*-->[\s\S]*?noscript>[\s\S]*?<!--\s*End\s+Google\s+Tag\s+Manager\s*-->/gi;
    let gtmNoscriptMatch;
    while ((gtmNoscriptMatch = gtmNoscriptRegex.exec(html)) !== null) {
      const gtmIdMatch = gtmNoscriptMatch[0].match(/id=([^"'\s>]+)/i);
      trackers.push({
        type: 'Google Tag Manager (Noscript)',
        category: 'tag-manager',
        name: 'GTM Noscript',
        identifier: gtmIdMatch ? gtmIdMatch[1] : 'unknown',
        domain: 'googletagmanager.com',
        snippet: gtmNoscriptMatch[0].substring(0, 300) + '...',
        location: this.detectLocation(html, gtmNoscriptMatch.index),
        lineNumber: this.getLineNumber(html, gtmNoscriptMatch.index, lines),
        risk: 'high',
      });
    }

    // === MICROSOFT CLARITY ===
    const clarityRegex = /clarity\.ms\/tag\/([^"'\s>]+)/gi;
    let clarityMatch;
    while ((clarityMatch = clarityRegex.exec(html)) !== null) {
      const snippet = this.extractSnippet(html, clarityMatch.index, 200);
      trackers.push({
        type: 'Microsoft Clarity',
        category: 'analytics',
        name: 'Microsoft Clarity',
        identifier: clarityMatch[1] || 'unknown',
        domain: 'clarity.ms',
        snippet: snippet,
        location: this.detectLocation(html, clarityMatch.index),
        lineNumber: this.getLineNumber(html, clarityMatch.index, lines),
        risk: 'medium',
      });
    }

    // === HOTJAR ===
    const hotjarRegex = /hotjar\.com\/|hj\(/gi;
    let hotjarMatch;
    while ((hotjarMatch = hotjarRegex.exec(html)) !== null) {
      const snippet = this.extractSnippet(html, hotjarMatch.index, 200);
      const hjIdMatch = html
        .substring(hotjarMatch.index, hotjarMatch.index + 300)
        .match(/hjid['":\s]*[:=]\s*['"]?(\d+)/i);
      trackers.push({
        type: 'Hotjar',
        category: 'monitoring',
        name: 'Hotjar',
        identifier: hjIdMatch ? hjIdMatch[1] : 'unknown',
        domain: 'hotjar.com',
        snippet: snippet,
        location: this.detectLocation(html, hotjarMatch.index),
        lineNumber: this.getLineNumber(html, hotjarMatch.index, lines),
        risk: 'medium',
      });
    }

    // === UTMFY ===
    const utmfyRegex = /utmfy\.com\.br|utmz\.com|scripts\/utms\/latest\.js/gi;
    let utmfyMatch;
    while ((utmfyMatch = utmfyRegex.exec(html)) !== null) {
      const snippet = this.extractSnippet(html, utmfyMatch.index, 200);
      trackers.push({
        type: 'UTMFY',
        category: 'other',
        name: 'UTMFY Tracking',
        identifier: 'unknown',
        domain: 'utmfy.com.br',
        snippet: snippet,
        location: this.detectLocation(html, utmfyMatch.index),
        lineNumber: this.getLineNumber(html, utmfyMatch.index, lines),
        risk: 'medium',
      });
    }

    // === PIXELYOURSITE ===
    const pysRegex = /pysFacebookRest|pixel-your-site|PixelYourSite/gi;
    let pysMatch;
    while ((pysMatch = pysRegex.exec(html)) !== null) {
      const snippet = this.extractSnippet(html, pysMatch.index, 200);
      trackers.push({
        type: 'PixelYourSite',
        category: 'pixel',
        name: 'PixelYourSite',
        identifier: 'unknown',
        domain: 'connect.facebook.net',
        snippet: snippet,
        location: this.detectLocation(html, pysMatch.index),
        lineNumber: this.getLineNumber(html, pysMatch.index, lines),
        risk: 'high',
      });
    }

    // === SCRIPTS EXTERNOS DE TRACKING ===
    const trackingDomains = [
      {
        domain: 'facebook.com',
        name: 'Facebook',
        category: 'social-media' as const,
      },
      {
        domain: 'facebook.net',
        name: 'Facebook',
        category: 'social-media' as const,
      },
      {
        domain: 'analytics.google.com',
        name: 'Google Analytics',
        category: 'analytics' as const,
      },
      {
        domain: 'google-analytics.com',
        name: 'Google Analytics',
        category: 'analytics' as const,
      },
      {
        domain: 'googletagmanager.com',
        name: 'Google Tag Manager',
        category: 'tag-manager' as const,
      },
      {
        domain: 'doubleclick.net',
        name: 'DoubleClick',
        category: 'analytics' as const,
      },
      {
        domain: 'pinterest.com',
        name: 'Pinterest Pixel',
        category: 'social-media' as const,
      },
      {
        domain: 'linkedin.com',
        name: 'LinkedIn Insight',
        category: 'social-media' as const,
      },
      {
        domain: 'tiktok.com',
        name: 'TikTok Pixel',
        category: 'social-media' as const,
      },
      {
        domain: 'segment.com',
        name: 'Segment',
        category: 'analytics' as const,
      },
      {
        domain: 'mixpanel.com',
        name: 'Mixpanel',
        category: 'analytics' as const,
      },
      {
        domain: 'amplitude.com',
        name: 'Amplitude',
        category: 'analytics' as const,
      },
      {
        domain: 'heap.io',
        name: 'Heap Analytics',
        category: 'analytics' as const,
      },
      { domain: 'hotjar.com', name: 'Hotjar', category: 'monitoring' as const },
      {
        domain: 'clarity.ms',
        name: 'Microsoft Clarity',
        category: 'analytics' as const,
      },
    ];

    for (const { domain, name, category } of trackingDomains) {
      const scriptRegex = new RegExp(
        `<script[^>]*src=["'][^"']*${domain.replace(
          /\./g,
          '\\.'
        )}[^"']*["'][^>]*>`,
        'gi'
      );
      let scriptMatch: RegExpExecArray | null;
      while ((scriptMatch = scriptRegex.exec(html)) !== null) {
        // Verificar se já não foi adicionado
        const matchIndex = scriptMatch?.index || 0;
        const alreadyAdded = trackers.some(
          (t) =>
            t.domain === domain &&
            t.lineNumber === this.getLineNumber(html, matchIndex, lines)
        );
        if (!alreadyAdded && scriptMatch) {
          const snippet = this.extractSnippet(html, matchIndex, 200);
          const scriptTag = html.substring(matchIndex, matchIndex + 500);
          const idMatch = scriptTag.match(/id=["']?([^"'\s>]+)/i);
          trackers.push({
            type: name,
            category: category,
            name: `${name} Script`,
            identifier: idMatch ? idMatch[1] : domain,
            domain: domain,
            snippet: snippet,
            location: 'external',
            lineNumber: this.getLineNumber(html, matchIndex, lines),
            risk: category === 'tag-manager' ? 'high' : 'medium',
          });
        }
      }
    }

    // === META TAGS DE TRACKING ===
    const metaVerificationRegex =
      /<meta\s+name=["'](?:facebook-domain-verification|google-site-verification|msapplication-TileImage)[^>]*>/gi;
    let metaMatch;
    while ((metaMatch = metaVerificationRegex.exec(html)) !== null) {
      const metaTag = metaMatch[0];
      const nameMatch = metaTag.match(/name=["']([^"']+)/i);
      const contentMatch = metaTag.match(/content=["']([^"']+)/i);
      trackers.push({
        type: 'Meta Verification Tag',
        category: 'other',
        name: nameMatch ? nameMatch[1] : 'Meta Tag',
        identifier: contentMatch ? contentMatch[1].substring(0, 50) : 'unknown',
        snippet: metaTag,
        location: 'head',
        lineNumber: this.getLineNumber(html, metaMatch.index, lines),
        risk: 'low',
      });
    }

    // Calcular estatísticas
    const byCategory = {
      pixel: trackers.filter((t) => t.category === 'pixel').length,
      analytics: trackers.filter((t) => t.category === 'analytics').length,
      'tag-manager': trackers.filter((t) => t.category === 'tag-manager')
        .length,
      'social-media': trackers.filter((t) => t.category === 'social-media')
        .length,
      ecommerce: trackers.filter((t) => t.category === 'ecommerce').length,
      affiliate: trackers.filter((t) => t.category === 'affiliate').length,
      monitoring: trackers.filter((t) => t.category === 'monitoring').length,
      other: trackers.filter((t) => t.category === 'other').length,
    };

    // Criar resumo
    const summary = {
      facebookPixel: trackers.some((t) => t.type.includes('Facebook Pixel')),
      googleAnalytics: trackers.some((t) =>
        t.type.includes('Google Analytics')
      ),
      googleTagManager: trackers.some((t) =>
        t.type.includes('Google Tag Manager')
      ),
      microsoftClarity: trackers.some((t) =>
        t.type.includes('Microsoft Clarity')
      ),
      utmfy: trackers.some((t) => t.type.includes('UTMFY')),
      hotjar: trackers.some((t) => t.type.includes('Hotjar')),
      customPixels: trackers
        .filter((t) => t.category === 'pixel' && !t.type.includes('Facebook'))
        .map((t) => t.type),
    };

    console.log(
      `✅ [analyzeTrackingCodes] Análise concluída: ${trackers.length} rastreadores encontrados`
    );

    return {
      totalFound: trackers.length,
      byCategory,
      trackers: trackers.slice(0, 100), // Limitar a 100 para não sobrecarregar
      summary,
    };
  }

  /**
   * 🔧 HELPER: Extrair snippet do HTML ao redor de um índice
   */
  private extractSnippet(
    html: string,
    index: number,
    length: number = 200
  ): string {
    const start = Math.max(0, index - 50);
    const end = Math.min(html.length, index + length);
    let snippet = html.substring(start, end);
    // Limpar quebras de linha excessivas
    snippet = snippet.replace(/\n\s*\n/g, '\n');
    // Limitar tamanho
    if (snippet.length > 300) {
      snippet = snippet.substring(0, 300) + '...';
    }
    return snippet;
  }

  /**
   * 🔧 HELPER: Detectar localização do código (head, body, inline, external)
   */
  private detectLocation(
    html: string,
    index: number
  ): 'head' | 'body' | 'inline' | 'external' {
    const beforeIndex = html.substring(0, index);
    const lastHeadEnd = beforeIndex.lastIndexOf('</head>');
    const lastBodyStart = beforeIndex.lastIndexOf('<body');
    const lastBodyEnd = beforeIndex.lastIndexOf('</body>');

    if (lastHeadEnd === -1 || lastBodyStart === -1) {
      return 'inline';
    }

    if (lastBodyStart > lastHeadEnd) {
      return 'body';
    }

    if (index > lastHeadEnd) {
      return 'body';
    }

    return 'head';
  }

  /**
   * 🔧 HELPER: Obter número da linha de um índice no HTML
   */
  private getLineNumber(html: string, index: number, lines: string[]): number {
    let charCount = 0;
    for (let i = 0; i < lines.length; i++) {
      charCount += lines[i].length + 1; // +1 para newline
      if (charCount > index) {
        return i + 1;
      }
    }
    return lines.length;
  }
}

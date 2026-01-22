import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import JSZip from 'jszip';
import * as crypto from 'crypto';
import * as cheerio from 'cheerio';

export interface ExportOptions {
  includeAssets: boolean;
  separateCSS: boolean;
  separateJS: boolean;
  minify: boolean;
  customCode?: {
    head?: string;
    bodyStart?: string;
    bodyEnd?: string;
  };
}

interface Asset {
  url: string;
  type: 'images' | 'videos' | 'fonts' | 'styles' | 'scripts';
  filename: string;
}

@Injectable()
export class ExportService {
  /**
   * Exporta página como arquivo ZIP completo
   */
  async exportAsZip(
    html: string,
    originalUrl: string,
    options: ExportOptions = {
      includeAssets: true,
      separateCSS: true,
      separateJS: true,
      minify: false
    }
  ): Promise<Buffer> {
    console.log('📦 [ExportService] Iniciando export como ZIP');
    console.log('📦 [ExportService] Opções:', options);

    const zip = new JSZip();
    let processedHtml = html;

    try {
      // 0. CRITICAL: Remover tag <base> que quebra caminhos relativos
      processedHtml = processedHtml.replace(/<base[^>]*>/gi, '');
      console.log('📦 [ExportService] Tag <base> removida');

      // 1. Extrair CSS (inline + externos)
      const cssFiles: { filename: string; content: string }[] = [];
      
      if (options.separateCSS) {
        // 1.1. Extrair CSS inline
        const inlineCSS = this.extractCSS(html);
        if (inlineCSS && inlineCSS.trim().length > 0) {
          cssFiles.push({ filename: 'styles.css', content: inlineCSS });
          
          // Remover CSS inline do HTML
          processedHtml = processedHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        }
        
        // 1.2. Baixar CSS externos (com href)
        const externalStyles = this.extractExternalStyles(processedHtml);
        console.log('📦 [ExportService] Stylesheets externos encontrados:', externalStyles.length);
        
        for (const style of externalStyles) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(style.url, {
              signal: controller.signal,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
              const cssContent = await response.text();
              cssFiles.push({ filename: style.filename, content: cssContent });
              
              // Substituir URL no HTML
              const escapedUrl = style.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              processedHtml = processedHtml.replace(
                new RegExp(`<link[^>]*href=["']${escapedUrl}["'][^>]*>`, 'gi'),
                `<link rel="stylesheet" href="css/${style.filename}">`
              );
              
              console.log('✅ CSS externo baixado:', style.filename);
            }
          } catch (error) {
            console.warn('⚠️ Falha ao baixar CSS:', style.url, error instanceof Error ? error.message : 'Erro desconhecido');
          }
        }
        
        // Adicionar todos os arquivos CSS ao ZIP
        for (const cssFile of cssFiles) {
          zip.file(`css/${cssFile.filename}`, cssFile.content);
        }
        
        // Se havia CSS inline, adicionar referência ao arquivo consolidado
        if (inlineCSS && inlineCSS.trim().length > 0) {
          processedHtml = processedHtml.replace(
            '</head>',
            '<link rel="stylesheet" href="css/styles.css">\n</head>'
          );
        }
        
        console.log('📦 [ExportService] Total de arquivos CSS:', cssFiles.length);
      }

      // 2. Extrair JavaScript (inline e externos)
      const jsFiles: { filename: string; content: string }[] = [];
      
      if (options.separateJS) {
        // 2.1. Extrair scripts inline
        const inlineJS = this.extractJS(html);
        if (inlineJS && inlineJS.trim().length > 0) {
          jsFiles.push({ filename: 'scripts.js', content: inlineJS });
          
          // Remover scripts inline do HTML
          processedHtml = processedHtml.replace(
            /<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/gi,
            ''
          );
        }
        
        // 2.2. Baixar scripts externos (com src)
        const externalScripts = this.extractExternalScripts(processedHtml);
        console.log('📦 [ExportService] Scripts externos encontrados:', externalScripts.length);
        
        for (const script of externalScripts) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(script.url, {
              signal: controller.signal,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
              const jsContent = await response.text();
              jsFiles.push({ filename: script.filename, content: jsContent });
              
              // Substituir URL no HTML
              const escapedUrl = script.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              processedHtml = processedHtml.replace(
                new RegExp(escapedUrl, 'g'),
                `js/${script.filename}`
              );
              
              console.log('✅ Script externo baixado:', script.filename);
            }
          } catch (error) {
            console.warn('⚠️ Falha ao baixar script:', script.url, error instanceof Error ? error.message : 'Erro desconhecido');
          }
        }
        
        // Adicionar todos os arquivos JS ao ZIP
        for (const jsFile of jsFiles) {
          zip.file(`js/${jsFile.filename}`, jsFile.content);
        }
        
        // Se havia scripts inline, adicionar referência ao arquivo consolidado
        if (inlineJS && inlineJS.trim().length > 0) {
          processedHtml = processedHtml.replace(
            '</body>',
            '<script src="js/scripts.js"></script>\n</body>'
          );
        }
        
        console.log('📦 [ExportService] Total de arquivos JS:', jsFiles.length);
      }

      // 3. Adicionar código customizado
      if (options.customCode) {
        if (options.customCode.head) {
          processedHtml = processedHtml.replace(
            '</head>',
            `${options.customCode.head}\n</head>`
          );
        }
        if (options.customCode?.bodyStart) {
          processedHtml = processedHtml.replace(
            /<body([^>]*)>/i,
            (match, attrs) => `<body${attrs}>\n${options.customCode?.bodyStart}`
          );
        }
        if (options.customCode.bodyEnd) {
          processedHtml = processedHtml.replace(
            '</body>',
            `${options.customCode.bodyEnd}\n</body>`
          );
        }
      }

      // 4. Download de assets (se habilitado)
      const assetMap = new Map<string, string>();
      
      if (options.includeAssets) {
        const assets = this.extractAssets(processedHtml);
        console.log('📦 [ExportService] Assets encontrados:', assets.length);
        
        for (const asset of assets) {
          try {
            console.log('📥 Baixando asset:', asset.url.substring(0, 80));
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(asset.url, {
              signal: controller.signal,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            
            const localPath = `assets/${asset.type}/${asset.filename}`;
            zip.file(localPath, buffer);
            assetMap.set(asset.url, localPath);
            
            console.log('✅ Asset baixado:', localPath);
          } catch (error) {
            console.warn('⚠️ Falha ao baixar asset:', asset.url, error instanceof Error ? error.message : 'Erro desconhecido');
          }
        }
        
        // Substituir URLs no HTML
        for (const [originalUrl, localPath] of assetMap) {
          const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          processedHtml = processedHtml.replace(new RegExp(escapedUrl, 'g'), localPath);
        }
        
        console.log('📦 [ExportService] URLs substituídas:', assetMap.size);
      }

      // 5. Adicionar HTML processado
      zip.file('index.html', processedHtml);

      // 6. Gerar ZIP
      const buffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
      });

      console.log('📦 [ExportService] ZIP gerado:', buffer.length, 'bytes');
      return buffer;

    } catch (error) {
      console.error('❌ [ExportService] Erro ao gerar ZIP:', error);
      throw new HttpException(
        `Erro ao gerar export: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Extrai CSS inline do HTML
   */
  private extractCSS(html: string): string {
    const cssBlocks: string[] = [];
    const $ = cheerio.load(html);

    // Extrair de tags <style>
    $('style').each((_, el) => {
      const css = $(el).html();
      if (css) {
        cssBlocks.push(css);
      }
    });

    // Extrair de links externos (se possível)
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.startsWith('http')) {
        cssBlocks.push(`/* Stylesheet: ${href} */`);
      }
    });

    return cssBlocks.join('\n\n');
  }

  /**
   * Extrai JavaScript inline do HTML
   */
  private extractJS(html: string): string {
    const jsBlocks: string[] = [];
    const $ = cheerio.load(html);

    // Extrair apenas scripts inline (sem src)
    $('script').each((_, el) => {
      const src = $(el).attr('src');
      if (!src) {
        const js = $(el).html();
        if (js && js.trim()) {
          // Ignorar scripts do editor (cp-editor, tuglet, etc.)
          if (!js.includes('cp-editor') && !js.includes('tuglet')) {
            jsBlocks.push(js);
          }
        }
      }
    });

    return jsBlocks.join('\n\n');
  }

  /**
   * Extrai URLs de scripts externos do HTML
   */
  private extractExternalScripts(html: string): Array<{ url: string; filename: string }> {
    const scripts: Array<{ url: string; filename: string }> = [];
    const seen = new Set<string>();
    const $ = cheerio.load(html);

    $('script[src]').each((_, el) => {
      const src = $(el).attr('src');
      
      // Apenas scripts HTTP/HTTPS externos
      if (src && src.startsWith('http') && !seen.has(src)) {
        seen.add(src);
        
        // Gerar nome de arquivo baseado na URL
        const filename = this.generateFilename(src, 'script');
        scripts.push({ url: src, filename });
      }
    });

    return scripts;
  }

  /**
   * Extrai URLs de stylesheets externos do HTML
   */
  private extractExternalStyles(html: string): Array<{ url: string; filename: string }> {
    const styles: Array<{ url: string; filename: string }> = [];
    const seen = new Set<string>();
    const $ = cheerio.load(html);

    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      
      // Apenas stylesheets HTTP/HTTPS externos
      if (href && href.startsWith('http') && !seen.has(href)) {
        seen.add(href);
        
        // Gerar nome de arquivo baseado na URL
        const filename = this.generateFilename(href, 'style');
        styles.push({ url: href, filename });
      }
    });

    return styles;
  }

  /**
   * Extrai assets (imagens, vídeos, fontes) do HTML
   */
  private extractAssets(html: string): Asset[] {
    const assets: Asset[] = [];
    const seen = new Set<string>();
    const $ = cheerio.load(html);

    // 1. Imagens
    $('img').each((_, el) => {
      const src = $(el).attr('src');
      if (src && src.startsWith('http') && !seen.has(src)) {
        seen.add(src);
        const filename = this.generateFilename(src, 'img');
        assets.push({ url: src, type: 'images', filename });
      }
    });

    // 2. Backgrounds CSS (url(...))
    const bgRegex = /url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/gi;
    let match;
    while ((match = bgRegex.exec(html)) !== null) {
      const url = match[1];
      if (!seen.has(url)) {
        seen.add(url);
        const filename = this.generateFilename(url, 'bg');
        assets.push({ url, type: 'images', filename });
      }
    }

    // 3. Vídeos (source tags)
    $('video source').each((_, el) => {
      const src = $(el).attr('src');
      if (src && src.startsWith('http') && !seen.has(src)) {
        seen.add(src);
        const filename = this.generateFilename(src, 'video');
        assets.push({ url: src, type: 'videos', filename });
      }
    });

    // 4. Fontes (@font-face)
    const fontRegex = /@font-face\s*\{[^}]*url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/gi;
    while ((match = fontRegex.exec(html)) !== null) {
      const url = match[1];
      if (!seen.has(url)) {
        seen.add(url);
        const filename = this.generateFilename(url, 'font');
        assets.push({ url, type: 'fonts', filename });
      }
    }

    console.log('📦 [ExportService] Assets extraídos:', {
      total: assets.length,
      images: assets.filter(a => a.type === 'images').length,
      videos: assets.filter(a => a.type === 'videos').length,
      fonts: assets.filter(a => a.type === 'fonts').length
    });

    return assets;
  }

  /**
   * Gera nome único para asset baseado em URL
   */
  private generateFilename(url: string, prefix: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      
      // Detectar extensão do arquivo
      const extMatch = pathname.match(/\.(jpg|jpeg|png|gif|webp|svg|mp4|webm|woff|woff2|ttf|otf|eot|js|css)$/i);
      let ext = extMatch ? extMatch[0] : '';
      
      // Se não encontrou extensão, definir baseado no prefix
      if (!ext) {
        if (prefix === 'script') ext = '.js';
        else if (prefix === 'style') ext = '.css';
        else ext = '.jpg';
      }
      
      // Gerar hash único
      const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
      
      return `${prefix}_${hash}${ext}`;
    } catch {
      // Fallback em caso de erro
      const ext = prefix === 'script' ? '.js' : prefix === 'style' ? '.css' : '.jpg';
      return `${prefix}_${Date.now()}${ext}`;
    }
  }
}

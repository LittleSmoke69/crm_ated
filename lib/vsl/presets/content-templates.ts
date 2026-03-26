import type { VslContentRoot } from '../runtime/types';
import type { HeadlineRichTextNode } from '../runtime/types';

/** Monta content_json a partir dos dados da tela Conteúdo (header_title, marquee_text, title) para o Design mostrar o mesmo modelo */
export function buildContentFromFormData(headerTitle: string, marqueeText: string, pageTitle: string): VslContentRoot {
  const id = () => `form-${Math.random().toString(36).slice(2, 9)}`;
  const headlineContent: HeadlineRichTextNode = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: pageTitle || 'Título da página' }],
      },
    ],
  };
  return {
    id: 'page',
    type: 'page',
    children: [
      {
        id: id(),
        type: 'newsTopbar',
        props: {
          variant: 'finance',
          centerTitleType: 'text',
          centerTitleText: headerTitle || 'FINANÇAS',
          showSearch: true,
          showRightMenu: true,
          bgColor: '#8B0B0B',
          textColor: '#FFFFFF',
        },
      },
      {
        id: id(),
        type: 'newsMarquee',
        props: {
          text: marqueeText || 'ATUALIZAÇÕES DIÁRIAS SOBRE FINANÇAS E APOSTAS',
          bgColor: '#7A0A0A',
          textColor: '#FFFFFF',
          speed: 60,
          uppercase: true,
        },
      },
      {
        id: id(),
        type: 'section',
        props: { maxWidth: '400px' },
        children: [
          {
            id: id(),
            type: 'headlineRich',
            props: {
              defaultFontSize: 30,
              defaultColor: '#111111',
              content: headlineContent,
            },
          },
          {
            id: id(),
            type: 'articleMeta',
            props: {
              authorName: 'Eduardo Leão',
              updatedText: 'Atualizado há 30 minutos - 09/02/2026',
              layout: 'stack',
            },
          },
          { id: id(), type: 'vturbVideo', props: { maxWidth: 400 } },
          {
            id: id(),
            type: 'buttonCTA',
            props: {
              text: 'Entrar no grupo',
              action: { type: 'redirect', redirectSlug: '' },
              minWatchPercent: 0,
              delaySeconds: 0,
            },
          },
        ],
      },
    ],
  };
}

const headlineRichFinance = {
  type: 'doc' as const,
  content: [
    {
      type: 'paragraph' as const,
      content: [
        { type: 'text' as const, text: 'Matemática Aplicada:', marks: [{ type: 'bold' as const }, { type: 'textStyle' as const, attrs: { color: '#B10E0E' } }] },
        { type: 'text' as const, text: ' Aumento de combinações eleva probabilidade real de premiação.' },
      ],
    },
  ],
};

const headlineRichCnn = {
  type: 'doc' as const,
  content: [
    {
      type: 'paragraph' as const,
      content: [
        { type: 'text' as const, text: 'Estudo Comparativo:', marks: [{ type: 'bold' as const }, { type: 'textStyle' as const, attrs: { color: '#B10E0E' } }] },
        { type: 'text' as const, text: ' Eficiência de jogos com 23 dezenas supera apostas tradicionais de 15.' },
      ],
    },
  ],
};

export type VslTemplateKey = 'finance' | 'cnn' | 'nbc' | 'bolao';

export function getContentTemplate(key: VslTemplateKey): VslContentRoot {
  const id = () => `${key}-${Math.random().toString(36).slice(2, 9)}`;
  switch (key) {
    case 'finance':
      return {
        id: 'page',
        type: 'page',
        children: [
          {
            id: id(),
            type: 'newsTopbar',
            props: {
              variant: 'finance',
              centerTitleType: 'text',
              centerTitleText: 'FINANÇAS',
              showSearch: true,
              showRightMenu: true,
              bgColor: '#8B0B0B',
              textColor: '#FFFFFF',
            },
          },
          {
            id: id(),
            type: 'newsMarquee',
            props: {
              text: 'ATUALIZAÇÕES DIÁRIAS SOBRE FINANÇAS E APOSTAS',
              bgColor: '#7A0A0A',
              textColor: '#FFFFFF',
              speed: 60,
              uppercase: true,
            },
          },
          {
            id: id(),
            type: 'section',
            props: { maxWidth: '400px' },
            children: [
              {
                id: id(),
                type: 'headlineRich',
                props: {
                  defaultFontSize: 30,
                  defaultColor: '#111111',
                  content: headlineRichFinance,
                },
              },
              {
                id: id(),
                type: 'articleMeta',
                props: {
                  authorName: 'Eduardo Leão',
                  updatedText: 'Atualizado há 30 minutos - 09/02/2026',
                  layout: 'stack',
                },
              },
              { id: id(), type: 'vturbVideo', props: { maxWidth: 400 } },
              {
                id: id(),
                type: 'buttonCTA',
                props: {
                  text: 'Entrar no grupo',
                  action: { type: 'redirect', redirectSlug: '' },
                  minWatchPercent: 0,
                  delaySeconds: 0,
                },
              },
            ],
          },
        ],
      };
    case 'cnn':
      return {
        id: 'page',
        type: 'page',
        children: [
          {
            id: id(),
            type: 'newsTopbar',
            props: {
              variant: 'cnn',
              bgColor: '#FFFFFF',
              textColor: '#000000',
              showHamburger: true,
              showSearch: true,
              centerTitleType: 'text',
              centerTitleText: 'CNN Mundo',
              rightButtonText: 'Entrar',
              rightButtonVariant: 'outline',
              showLiveBadge: true,
              liveBadgeText: 'ATUALIZAÇÕES AO VIVO',
              pills: [
                { text: 'EUA', style: 'circle', bg: '#666', color: '#fff' },
                { text: 'Segurança', style: 'circle', bg: '#666', color: '#fff' },
              ],
              borderBottom: '1px solid #eee',
            },
          },
          {
            id: id(),
            type: 'newsMarquee',
            props: {
              text: 'Enviado de Trump se reunirá com Putin',
              bgColor: '#f5f5f5',
              textColor: '#111',
              speed: 40,
              uppercase: false,
            },
          },
          {
            id: id(),
            type: 'section',
            props: { maxWidth: '400px' },
            children: [
              {
                id: id(),
                type: 'headlineRich',
                props: {
                  defaultFontSize: 30,
                  defaultColor: '#111111',
                  content: headlineRichCnn,
                },
              },
              {
                id: id(),
                type: 'articleMeta',
                props: {
                  authorName: 'Eduardo Leão',
                  updatedText: 'Atualizado há 30 minutos - 09/02/2026',
                  layout: 'stack',
                },
              },
              { id: id(), type: 'vturbVideo', props: { maxWidth: 400 } },
              {
                id: id(),
                type: 'buttonCTA',
                props: {
                  text: 'Entrar no grupo',
                  action: { type: 'redirect', redirectSlug: '' },
                  minWatchPercent: 0,
                  delaySeconds: 0,
                },
              },
            ],
          },
        ],
      };
    case 'nbc':
      return {
        id: 'page',
        type: 'page',
        children: [
          {
            id: id(),
            type: 'newsTopbar',
            props: {
              variant: 'nbc',
              bgColor: '#222222',
              textColor: '#FFFFFF',
              showRightMenu: true,
              centerTitleType: 'text',
              centerTitleText: 'NBC NEWS',
            },
          },
          {
            id: id(),
            type: 'section',
            props: { maxWidth: '400px' },
            children: [
              {
                id: id(),
                type: 'headlineRich',
                props: {
                  defaultFontSize: 30,
                  defaultColor: '#111111',
                  content: headlineRichCnn,
                },
              },
              {
                id: id(),
                type: 'articleMeta',
                props: {
                  authorName: 'Eduardo Leão',
                  updatedText: 'Atualizado há 30 minutos - 09/02/2026',
                  layout: 'stack',
                },
              },
              { id: id(), type: 'vturbVideo', props: { maxWidth: 400 } },
              {
                id: id(),
                type: 'buttonCTA',
                props: {
                  text: 'Entrar no grupo',
                  action: { type: 'redirect', redirectSlug: '' },
                  minWatchPercent: 0,
                  delaySeconds: 0,
                },
              },
            ],
          },
        ],
      };
    case 'bolao':
      return {
        id: 'page',
        type: 'page',
        children: [
          {
            id: id(),
            type: 'bolaoLanding',
            props: {
              logoUrl: '/logo_zaploto.png',
              backgroundColor: 'hsl(224, 60%, 12%)',
              titleBefore: 'Clique e Escolha ',
              titleHighlight: 'Seu Bolão!',
              subtitle: 'A Primeira Casa Lotérica Online do Brasil.',
              videoPlayerId: '69c1b2853d18cfb2430cce49',
              disableMessage: 'Configure o link do botão no painel',

              bolaoLotteryButtons: [
                {
                  badgeText: 'LOTOFACIL',
                  mainText: 'Lotinha',
                  href: 'https://web.agoraeuganho.online/combo/56dd2e02-790a-41d2-a75e-d5d0341d0984',
                  accentFrom: '#ff3ea5',
                  accentTo: '#b30068',
                  scheduleGroup: 'lotofacil-quina',
                },
                {
                  badgeText: 'QUINA',
                  mainText: 'Super 5',
                  href: 'https://web.agoraeuganho.online/combo/f158ac2b-41b1-48f2-a357-dc8c451d92a7',
                  accentFrom: '#7c3aed',
                  accentTo: '#4c1d95',
                  scheduleGroup: 'lotofacil-quina',
                },
                {
                  badgeText: 'MEGA-SENA',
                  mainText: 'Super 6',
                  href: 'https://web.agoraeuganho.online/combo/a1c35736-cd2a-414a-af6a-136b9babb15e',
                  accentFrom: '#2ddb6f',
                  accentTo: '#0f8038',
                  scheduleGroup: 'mega',
                },
              ],
              lotofacilNickname: 'Lotinha',
              lotofacilHref: 'https://web.agoraeuganho.online/combo/56dd2e02-790a-41d2-a75e-d5d0341d0984',
              lotofacilAccentFrom: '#ff3ea5',
              lotofacilAccentTo: '#b30068',
              quinaNickname: 'Super 5',
              quinaHref: 'https://web.agoraeuganho.online/combo/f158ac2b-41b1-48f2-a357-dc8c451d92a7',
              quinaAccentFrom: '#7c3aed',
              quinaAccentTo: '#4c1d95',
              megaNickname: 'Super 6',
              megaHref: 'https://web.agoraeuganho.online/combo/a1c35736-cd2a-414a-af6a-136b9babb15e',
              megaAccentFrom: '#2ddb6f',
              megaAccentTo: '#0f8038',

              whatsappHref: 'https://wa.me/557991055651',
              whatsappPrefix: 'Atendimento via',
              whatsappMain: 'Falar com Atendente',
              whatsappAccentFrom: '#2ddb6f',
              whatsappAccentTo: '#0f8038',
            },
          },
        ],
      };
    default:
      return getContentTemplate('finance');
  }
}

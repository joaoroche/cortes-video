const OpenAI = require('openai');
const config = require('../config');

// Cliente OpenAI
const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

/**
 * Scheduling recommendation service
 * Analyzes clip content and provides optimal posting times for TikTok/Reels
 */

/**
 * Melhores horários de postagem por categoria de conteúdo e dia da semana
 * Baseado em pesquisas de engajamento no TikTok/Instagram Reels
 */
const POSTING_SCHEDULES = {
  // Conteúdo Educacional/Tutorial
  educational: {
    weekday: [
      { time: '07:00-09:00', reason: 'Aprendizado durante o trajeto matinal' },
      { time: '12:00-13:00', reason: 'Conteúdo educacional no horário de almoço' },
      { time: '19:00-21:00', reason: 'Horário de estudo noturno' }
    ],
    weekend: [
      { time: '09:00-11:00', reason: 'Aprendizado na manhã de fim de semana' },
      { time: '14:00-16:00', reason: 'Autoaperfeiçoamento à tarde' }
    ]
  },

  // Entretenimento/Humor
  entertainment: {
    weekday: [
      { time: '12:00-13:00', reason: 'Entretenimento no intervalo do almoço' },
      { time: '18:00-20:00', reason: 'Relaxamento pós-trabalho' },
      { time: '21:00-23:00', reason: 'Horário nobre de entretenimento' }
    ],
    weekend: [
      { time: '11:00-13:00', reason: 'Navegação no fim de manhã de sábado/domingo' },
      { time: '16:00-18:00', reason: 'Entretenimento vespertino' },
      { time: '20:00-22:00', reason: 'Pico de noite de fim de semana' }
    ]
  },

  // Motivacional/Inspiracional
  motivational: {
    weekday: [
      { time: '06:00-08:00', reason: 'Motivação matinal para começar o dia' },
      { time: '12:00-13:00', reason: 'Inspiração no meio do dia' },
      { time: '17:00-18:00', reason: 'Motivação no fim do expediente' }
    ],
    weekend: [
      { time: '07:00-09:00', reason: 'Inspiração matinal de fim de semana' },
      { time: '19:00-21:00', reason: 'Motivação para a próxima semana (domingo)' }
    ]
  },

  // Notícias/Atualidades
  news: {
    weekday: [
      { time: '07:00-09:00', reason: 'Consumo de notícias pela manhã' },
      { time: '12:00-13:00', reason: 'Atualização de notícias no almoço' },
      { time: '18:00-19:00', reason: 'Notícias do início da noite' }
    ],
    weekend: [
      { time: '09:00-11:00', reason: 'Atualização de notícias do fim de semana' },
      { time: '19:00-20:00', reason: 'Resumo de domingo à noite' }
    ]
  },

  // Estilo de Vida/Saúde/Fitness
  lifestyle: {
    weekday: [
      { time: '06:00-08:00', reason: 'Rotina matinal e treino' },
      { time: '12:00-13:00', reason: 'Dicas de saúde no almoço' },
      { time: '17:00-19:00', reason: 'Fitness pós-trabalho' }
    ],
    weekend: [
      { time: '08:00-10:00', reason: 'Rotina matinal de fim de semana' },
      { time: '15:00-17:00', reason: 'Conteúdo de lifestyle à tarde' }
    ]
  },

  // Negócios/Finanças
  business: {
    weekday: [
      { time: '07:00-09:00', reason: 'Briefing matinal de negócios' },
      { time: '12:00-13:00', reason: 'Desenvolvimento profissional no almoço' },
      { time: '17:00-18:00', reason: 'Aprendizado de negócios pós-trabalho' }
    ],
    weekend: [
      { time: '10:00-12:00', reason: 'Empreendedorismo no fim de semana' },
      { time: '19:00-21:00', reason: 'Planejamento de domingo à noite' }
    ]
  },

  // Gaming/Tecnologia
  gaming: {
    weekday: [
      { time: '15:00-17:00', reason: 'Gaming pós-escola/faculdade' },
      { time: '20:00-23:00', reason: 'Horário nobre de games' }
    ],
    weekend: [
      { time: '11:00-13:00', reason: 'Sessão de gaming de fim de semana' },
      { time: '15:00-17:00', reason: 'Gaming vespertino' },
      { time: '20:00-00:00', reason: 'Gaming de madrugada no fim de semana' }
    ]
  },

  // Culinária/Gastronomia
  food: {
    weekday: [
      { time: '11:00-12:00', reason: 'Inspiração para receitas de almoço' },
      { time: '17:00-19:00', reason: 'Preparo do jantar' },
      { time: '20:00-21:00', reason: 'Conteúdo gastronômico noturno' }
    ],
    weekend: [
      { time: '10:00-12:00', reason: 'Ideias de brunch de fim de semana' },
      { time: '16:00-18:00', reason: 'Preparo de jantar especial' }
    ]
  }
};

/**
 * Horário padrão para conteúdo não classificado
 */
const DEFAULT_SCHEDULE = {
  weekday: [
    { time: '12:00-13:00', reason: 'Pico de engajamento no horário de almoço' },
    { time: '18:00-20:00', reason: 'Horário de pico vespertino' },
    { time: '21:00-22:00', reason: 'Navegação noturna' }
  ],
  weekend: [
    { time: '11:00-13:00', reason: 'Engajamento matinal de fim de semana' },
    { time: '16:00-18:00', reason: 'Pico vespertino de fim de semana' },
    { time: '20:00-22:00', reason: 'Pico noturno de fim de semana' }
  ]
};

/**
 * Analisa o conteúdo do clipe e classifica em uma categoria
 * @param {string} description - Descrição TikTok do clipe
 * @param {string} transcript - Texto da transcrição do clipe
 * @returns {Promise<{category: string, confidence: number, subcategory: string}>}
 */
async function analyzeClipContent(description, transcript) {
  try {
    const prompt = `Analise este conteúdo de clipe de vídeo e classifique em UMA categoria.

Descrição: ${description}

Trecho da transcrição: ${transcript.substring(0, 500)}...

Categorias:
- educational: Tutoriais, how-to, aprendizado, fatos, explicações
- entertainment: Humor, comédia, diversão, reações, histórias
- motivational: Inspiração, autoajuda, mindset, sucesso
- news: Eventos atuais, atualizações, anúncios
- lifestyle: Saúde, fitness, bem-estar, rotinas diárias
- business: Finanças, empreendedorismo, carreira, produtividade
- gaming: Videogames, esports, cultura gamer
- food: Culinária, receitas, restaurantes, avaliações gastronômicas

Responda APENAS com JSON em português:
{
  "category": "nome_da_categoria",
  "confidence": 0.0-1.0,
  "subcategory": "breve descrição da subcategoria em português",
  "reasoning": "por que esta categoria se encaixa"
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const analysis = JSON.parse(response.choices[0].message.content);
    return analysis;
  } catch (error) {
    console.error('Erro ao analisar conteúdo do clipe:', error.message);
    return {
      category: 'general',
      confidence: 0.5,
      subcategory: 'conteúdo geral',
      reasoning: 'Classificação falhou, usando padrão'
    };
  }
}

/**
 * Obtém recomendações específicas por dia baseado no tipo de conteúdo
 * @param {string} category - Categoria do conteúdo
 * @param {number} dayOfWeek - Dia da semana (0=Domingo, 6=Sábado)
 * @returns {Array<{day: string, times: Array}>}
 */
function getDayRecommendations(category, dayOfWeek = null) {
  const schedule = POSTING_SCHEDULES[category] || DEFAULT_SCHEDULE;
  const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

  const recommendations = [];

  // Se dia específico foi solicitado
  if (dayOfWeek !== null) {
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const times = isWeekend ? schedule.weekend : schedule.weekday;

    return [{
      day: days[dayOfWeek],
      dayType: isWeekend ? 'weekend' : 'weekday',
      times: times
    }];
  }

  // Fornecer recomendações para todos os dias
  days.forEach((day, index) => {
    const isWeekend = index === 0 || index === 6;
    const times = isWeekend ? schedule.weekend : schedule.weekday;

    recommendations.push({
      day,
      dayType: isWeekend ? 'weekend' : 'weekday',
      times: times
    });
  });

  return recommendations;
}

/**
 * Obtém os melhores horários recomendados durante a semana
 * @param {string} category - Categoria do conteúdo
 * @returns {Array<{day: string, time: string, reason: string, priority: number}>}
 */
function getTopRecommendations(category) {
  const schedule = POSTING_SCHEDULES[category] || DEFAULT_SCHEDULE;
  const recommendations = [];

  // Melhores horários de dias úteis
  const weekdayTimes = schedule.weekday.slice(0, 2); // Top 2
  weekdayTimes.forEach((slot, index) => {
    recommendations.push({
      day: 'Segunda-Sexta',
      time: slot.time,
      reason: slot.reason,
      priority: index + 1,
      engagement: 'high'
    });
  });

  // Melhores horários de fim de semana
  const weekendTimes = schedule.weekend.slice(0, 2); // Top 2
  weekendTimes.forEach((slot, index) => {
    recommendations.push({
      day: 'Sábado-Domingo',
      time: slot.time,
      reason: slot.reason,
      priority: index + 3,
      engagement: index === 0 ? 'high' : 'medium'
    });
  });

  return recommendations;
}

/**
 * Gera cronograma de postagem específico para os próximos 7 dias
 * @param {string} category - Categoria do conteúdo
 * @returns {Array<{date: string, day: string, recommendedTimes: Array}>}
 */
function getNext7DaysSchedule(category) {
  const schedule = POSTING_SCHEDULES[category] || DEFAULT_SCHEDULE;
  const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const next7Days = [];

  const today = new Date();

  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);

    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const times = isWeekend ? schedule.weekend : schedule.weekday;

    next7Days.push({
      date: date.toISOString().split('T')[0],
      day: days[dayOfWeek],
      dayType: isWeekend ? 'weekend' : 'weekday',
      recommendedTimes: times.map((slot, index) => ({
        ...slot,
        priority: index + 1
      }))
    });
  }

  return next7Days;
}

/**
 * Gera recomendação completa de agendamento para um clipe
 * @param {string} description - Descrição TikTok do clipe
 * @param {string} transcript - Transcrição do clipe
 * @returns {Promise<Object>} Recomendação completa de agendamento
 */
async function generateSchedulingRecommendation(description, transcript) {
  // Analisar conteúdo para determinar categoria
  const contentAnalysis = await analyzeClipContent(description, transcript);

  // Obter recomendações
  const topRecommendations = getTopRecommendations(contentAnalysis.category);
  const next7Days = getNext7DaysSchedule(contentAnalysis.category);
  const allDayRecommendations = getDayRecommendations(contentAnalysis.category);

  return {
    contentAnalysis: {
      category: contentAnalysis.category,
      subcategory: contentAnalysis.subcategory,
      confidence: contentAnalysis.confidence,
      reasoning: contentAnalysis.reasoning
    },
    recommendations: {
      top: topRecommendations,
      next7Days: next7Days,
      byDayOfWeek: allDayRecommendations
    },
    tips: getPostingTips(contentAnalysis.category),
    generatedAt: new Date().toISOString()
  };
}

/**
 * Obtém dicas de postagem para uma categoria específica de conteúdo
 * @param {string} category - Categoria do conteúdo
 * @returns {Array<string>}
 */
function getPostingTips(category) {
  const tips = {
    educational: [
      'Poste consistentemente nos mesmos horários para criar hábitos na audiência',
      'Conteúdo educacional tem melhor desempenho durante horários de trajeto',
      'Considere postar séries ao longo de vários dias para aumentar retenção',
      'Segunda a quinta têm maior engajamento para conteúdo de aprendizado'
    ],
    entertainment: [
      'Horários noturnos (20h-23h) têm pico de engajamento em entretenimento',
      'Sexta a domingo são os melhores dias para conteúdo viral de entretenimento',
      'Evite segunda-feira de manhã quando usuários estão focados no trabalho',
      'Poste múltiplas vezes por dia para alcance máximo'
    ],
    motivational: [
      'Segunda-feira de manhã é perfeita para motivação semanal',
      'Posts noturnos (17h-19h) pegam usuários após o trabalho',
      'Domingo à noite funciona bem para preparação da próxima semana',
      'Posts matinais se alinham com estabelecimento de rotinas diárias'
    ],
    news: [
      'Poste notícias urgentes imediatamente para impacto máximo',
      'Manhã (7h-9h) captura usuários checando atualizações no trajeto',
      'Horário de almoço (12h-13h) tem alto consumo de notícias',
      'Engajamento em dias úteis é significativamente maior que fins de semana'
    ],
    lifestyle: [
      'Posts matinais (6h-8h) se alinham com rotinas diárias',
      'Conteúdo fitness tem pico antes/depois do horário de trabalho',
      'Manhãs de fim de semana são ideais para inspiração de lifestyle',
      'Conteúdo de saúde tem bom desempenho de segunda a quarta'
    ],
    business: [
      'Evite fins de semana - conteúdo de negócios é focado em dias úteis',
      'Horários matinais (7h-9h) alcançam profissionais começando o dia',
      'Terça a quinta têm maior engajamento profissional',
      'Horários de almoço pegam usuários em pausas de trabalho'
    ],
    gaming: [
      'Noite avançada (20h-meia-noite) é horário nobre de gaming',
      'Fins de semana têm 40% mais engajamento que dias úteis',
      'Evite manhãs cedo e horário comercial',
      'Sexta à noite inicia as sessões de gaming de fim de semana'
    ],
    food: [
      'Poste conteúdo de receitas 2-3 horas antes dos horários de refeição',
      'Conteúdo de jantar (17h-19h) tem maior engajamento',
      'Conteúdo de brunch funciona bem em manhãs de sábado e domingo',
      'Evite postar conteúdo de comida tarde da noite'
    ]
  };

  return tips[category] || [
    'Consistência é fundamental - poste nos mesmos horários regularmente',
    'Teste diferentes horários e acompanhe o que funciona para sua audiência',
    'Engaje com comentários na primeira hora após postar',
    'Evite postar múltiplas vezes em intervalo menor que 4 horas'
  ];
}

module.exports = {
  generateSchedulingRecommendation,
  analyzeClipContent,
  getDayRecommendations,
  getTopRecommendations,
  getNext7DaysSchedule,
  getPostingTips
};

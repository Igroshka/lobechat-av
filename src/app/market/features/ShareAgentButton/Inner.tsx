import { Icon } from '@lobehub/ui';
import { Tag } from 'antd';
import { Settings, Share2 } from 'lucide-react';
import Image from 'next/image';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import MobilePadding from '@/components/MobilePadding';

const Inner = memo(() => {
  const { t } = useTranslation('market');
  return (
    <MobilePadding>
      <Image
        alt={'banner'}
        height={602}
        src={'/images/banner_market_modal.webp'}
        style={{ height: 'auto', marginBottom: 24, width: '100%' }}
        width={1602}
      />
      <h3>
        <Tag color={'cyan'}>{t('guide.func1.tag')}</Tag>
        <span>{t('guide.func1.title')}</span>
      </h3>
      <p>
        <Icon icon={Settings} />
        {' - '}
        {t('guide.func1.desc1')}
        <br />
        <Icon icon={Share2} />
        {' - '}
        {t('guide.func1.desc2')}
      </p>
    </MobilePadding>
  );
});

export default Inner;

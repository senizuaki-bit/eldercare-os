'use client';

import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';

const labels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const values = [20, 18, 21, 17, 16, 19, 15];

export function ResponseTrendChart() {
  const chartElementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = chartElementRef.current;

    if (!element) {
      return undefined;
    }

    const chart = echarts.init(element, undefined, { renderer: 'canvas' });
    chart.setOption({
      animation: false,
      aria: {
        enabled: true,
        description: '本地演示数据。本周平均响应时长从周日二十分钟变化至周六十五分钟。'
      },
      grid: {
        top: 26,
        right: 14,
        bottom: 34,
        left: 42,
        containLabel: false
      },
      tooltip: {
        trigger: 'axis',
        textStyle: { fontSize: 14 },
        valueFormatter: (value: unknown) => `${String(value)} 分钟`
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: labels,
        axisLine: { lineStyle: { color: '#cbd5df' } },
        axisTick: { show: false },
        axisLabel: { color: '#647386', fontSize: 14 }
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 30,
        interval: 10,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#647386', fontSize: 14 },
        splitLine: { lineStyle: { color: '#e6ebf0', type: 'dashed' } }
      },
      series: [
        {
          name: '平均响应时长',
          type: 'line',
          data: values,
          symbol: 'circle',
          symbolSize: 7,
          smooth: false,
          lineStyle: { width: 2, color: '#2563eb' },
          itemStyle: { color: '#ffffff', borderColor: '#2563eb', borderWidth: 2 },
          emphasis: { scale: 1.15 },
          label: {
            show: true,
            position: 'top',
            color: '#4c5c6f',
            fontSize: 14,
            formatter: '{c}'
          }
        }
      ]
    });

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
    };
  }, []);

  return (
    <div
      ref={chartElementRef}
      className="response-trend-chart"
      role="img"
      aria-label="本周平均响应时长演示折线图：周日20、周一18、周二21、周三17、周四16、周五19、周六15分钟"
    />
  );
}

--4034040:LR_超サイヤ人孫悟空_気弾無効

--battle_301362

--as0032



setPhase(9); --フェーズ9開始

fcolor_r = 245;

fcolor_g = 245;

fcolor_b = 245;



--エフェクト

SP_01 = 3314; -- 気弾無効 ef_001



setEnvZoomEnable(0, 0); -- ズーム許可

removeAllEffect(2); --必要



------------------------------------------------------

-- テンプレ構文

------------------------------------------------------



setVisibleUI(0, 0);



setDisp( 0, 0, 0);

changeAnime( 0, 0, 0);



setMoveKey(   0,   0,    0, -5000,   0);

setMoveKey(   1,   0,    0, -5000,   0);

setMoveKey(   2,   0,    0, -5000,   0);

setMoveKey(   3,   0,    0, -5000,   0);

setMoveKey(   4,   0,    0, -5000,   0);

setMoveKey(   5,   0,    0, -5000,   0);

setMoveKey(   6,   0,    0, -5000,   0);

setScaleKey(  0,   0,  1.6, 1.6 );

setScaleKey(  1,   0,  1.6, 1.6 );

setScaleKey(  2,   0,  1.6, 1.6 );

setScaleKey(  3,   0,  1.6, 1.6 );

setScaleKey(  4,   0,  1.6, 1.6 );

setScaleKey(  5,   0,  1.6, 1.6 );

setScaleKey(  6,   0,  1.6, 1.6 );

setRotateKey( 0,   0,  0 );

setRotateKey( 1,   0,  0 );

setRotateKey( 2,   0,  0 );

setRotateKey( 3,   0,  0 );

setRotateKey( 4,   0,  0 );

setRotateKey( 5,   0,  0 );

setRotateKey( 6,   0,  0 );



setDisp( 0, 1, 0);

changeAnime( 0, 1, 100);

setAlphaKey( 0, 1, 255 );



setMoveKey(   0,   1,    0, -5000,   0);

setMoveKey(   1,   1,    0, -5000,   0);

setMoveKey(   2,   1,    0, -5000,   0);

setMoveKey(   3,   1,    0, -5000,   0);

setMoveKey(   4,   1,    0, -5000,   0);

setMoveKey(   5,   1,    0, -5000,   0);

setMoveKey(   6,   1,    0, -5000,   0);



setScaleKey(  0,   1,  1.6, 1.6 );

setScaleKey(  1,   1,  1.6, 1.6 );

setScaleKey(  2,   1,  1.6, 1.6 );

setScaleKey(  3,   1,  1.6, 1.6 );

setScaleKey(  4,   1,  1.6, 1.6 );

setScaleKey(  5,   1,  1.6, 1.6 );

setScaleKey(  6,   1,  1.6, 1.6 );

setRotateKey( 0,   1,  0 );

setRotateKey( 1,   1,  0 );

setRotateKey( 2,   1,  0 );

setRotateKey( 3,   1,  0 );

setRotateKey( 4,   1,  0 );

setRotateKey( 5,   1,  0 );

setRotateKey( 6,   1,  0 );



ENABLE_AUTO_TIME_STRETCH(0.84);



------------------------------------------------------------------------------------------------------------

--冒頭固定

------------------------------------------------------------------------------------------------------------

-- ** 白フェード ** --

entryFade( 4, 0, 4, 4, fcolor_r, fcolor_g, fcolor_b, 255 );



------------------------------------------------------------------------------------------------------------

--味方側 or 敵側

--味方側の場合はあり

--敵側の場合はコメントアウト

--(ただし敵味方共通のエフェクトの場合で反転した敵側専用のエフェクトがある場合はあり)

------------------------------------------------------------------------------------------------------------

flipAttackerSide(0)



------------------------------------------------------------------------------------------------------------

--開始4F固定 (顔カットインが入るため)

------------------------------------------------------------------------------------------------------------



spep_0 = 4;



-------------------------------------------------

-- 最初から最後まで

-------------------------------------------------



MAX_FRAME_0 = 460;



setupMovie(spep_0 + 0, SP_01, 0, 1);



-- ** エフェクト等 ** --

base_0 = entryEffect( spep_0 + 0, SP_01, 0x100, -1, 0, 0, 0); -- 最初から最後まで ef_001

setEffMoveKey( spep_0 + 0, base_0, 0, 0 , 0);

setEffMoveKey( spep_0 + MAX_FRAME_0, base_0, 0, 0 , 0);

setEffScaleKey( spep_0 + 0, base_0, 1.0, 1.0);

setEffScaleKey( spep_0 + MAX_FRAME_0, base_0, 1.0, 1.0);

setEffRotateKey( spep_0 + 0, base_0, 0);

setEffRotateKey( spep_0 + MAX_FRAME_0, base_0, 0);

setEffAlphaKey( spep_0 + 0, base_0, 255);

setEffAlphaKey( spep_0 + MAX_FRAME_0, base_0, 255);



-- ** 黒背景 ** --

entryFadeBg( spep_0 + 0, 0, MAX_FRAME_0 + 2, 0, 0, 0, 0, 255); --黒 背景



-- ** 音 ** --

--気弾飛んでくる

SE001 = playSeVer2( spep_0 + 0, 1022, "", 0, 0, 0, -1);

SE002 = playSeVer2( spep_0 + 0, 1424, "", 0, 0, 0, -1);

SE003 = playSeVer2( spep_0 + 0, 1312, "", 0, 0, 0, -1);



--気弾ヒット

SE004 = playSeVer2( spep_0 + 76, 1047, "", 0, 0, 0, -1);	

SE005 = playSeVer2( spep_0 + 76, 1126, "",spep_0 + 181, 0, 85, -1);

setSeVolumeByWorkId( spep_0 + 76, SE005, 86 );

SE006 = playSeVer2( spep_0 + 76, 1145, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_0 + 76, SE006, 68 );

SE008 = playSeVer2( spep_0 + 82, 1110, "", 0, 0, 0, -1);



--環境音

SE007 = playSeVer2( spep_0 + 74, 1349, "", 0, 0, 0, -1);

setSeVolumeByWorkId( spep_0 + 74, SE007, 25 );



--環境音

SE009 = playSeVer2( spep_0 + 169, 1278, "", 0, 70, 0, -1);

setSeVolumeByWorkId( spep_0 + 169, SE009, 39 );



--セリフカットイン

SE010 = playSeVer2( spep_0 + 360, 44, "", 0, 0, 0, -1);	

SE011 = playSeVer2( spep_0 + 360, 1018, "", 0, 0, 0, -1);	



-- ** ダメージ表示 ** --

-- ** 無効演出の場合 ** --

dealDamage( spep_0 + 350 );

endPhase( spep_0 + MAX_FRAME_0);  --460F